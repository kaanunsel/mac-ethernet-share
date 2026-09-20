import Foundation
import IOKit
import IOKit.ps
import SystemConfiguration
import Darwin

// Build-time configuration is compiled into the root-owned installed binary.
let ethernetMAC = Configuration.ethernetMAC.lowercased()
let wifi = Configuration.upstreamInterface
let gateway = "192.168.2.1"
let clientIP = "192.168.2.2"
let anchor = "com.apple/ethernetshare"
#if TESTING
let directory = NSTemporaryDirectory() + "ethernetshare-tests-" + UUID().uuidString
var commandOverride: ((String, [String], String?) throws -> String)?
var testLidClosed = false
var testMatchingAdapter: String? = "en9"
#else
let directory = "/var/db/ethernetshare"
#endif
let statePath = directory + "/state.json"
let receiptPath = directory + "/pf-reference.txt"
let pausedPath = directory + "/paused"
let logPath = "/var/log/ethernetshare.log"
let fm = FileManager.default

struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}

func log(_ message: String) {
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(message)"
    print(line)
    fflush(stdout)
    #if !TESTING
    // Open per event so newsyslog rotation is picked up without restarting sharing.
    if geteuid() == 0, let data = (line + "\n").data(using: .utf8) {
        do {
            let handle = try FileHandle(forWritingTo: URL(fileURLWithPath: logPath))
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
            try handle.synchronize()
            try handle.close()
        } catch {
            // Console output above remains available to launchd during early installation.
        }
    }
    #endif
}

// No shell evaluation; arguments and stdin are always passed separately.
@discardableResult
func run(_ path: String, _ args: [String], input: String? = nil) throws -> String {
    #if TESTING
    guard let execute = commandOverride else { throw Failure("Test build cannot execute system commands") }
    return try execute(path, args, input)
    #else
    let task = Process()
    task.executableURL = URL(fileURLWithPath: path)
    task.arguments = args
    task.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "C"]
    let output = Pipe()
    // pfctl's reference token survives a daemon crash between acquisition and JSON save.
    let receipt: FileHandle?
    if path == "/sbin/pfctl" && args == ["-E"] {
        try Data().write(to: URL(fileURLWithPath: receiptPath), options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: receiptPath)
        receipt = try FileHandle(forWritingTo: URL(fileURLWithPath: receiptPath))
    } else { receipt = nil }
    task.standardOutput = receipt ?? output.fileHandleForWriting
    task.standardError = receipt ?? output.fileHandleForWriting
    let pipe = Pipe()
    task.standardInput = input == nil ? FileHandle.nullDevice : pipe.fileHandleForReading
    try task.run()
    // Process receives duplicated descriptors. Close our unused pipe ends so EOF is
    // observable after the child exits; retaining the writer makes readDataToEndOfFile hang.
    if receipt == nil {
        try output.fileHandleForWriting.close()
    }
    if input != nil {
        try pipe.fileHandleForReading.close()
    }
    // A stuck utility must not leave power-source/removal events blocked indefinitely.
    let deadline = DispatchSource.makeTimerSource(queue: .global())
    deadline.schedule(deadline: .now() + 5)
    deadline.setEventHandler {
        if task.isRunning {
            task.terminate()
            DispatchQueue.global().asyncAfter(deadline: .now() + 1) {
                if task.isRunning { kill(task.processIdentifier, SIGKILL) }
            }
        }
    }
    deadline.resume()
    defer { deadline.cancel() }
    if let input {
        pipe.fileHandleForWriting.write(Data(input.utf8))
        try pipe.fileHandleForWriting.close()
    }
    let data: Data
    if let receipt {
        task.waitUntilExit()
        try receipt.synchronize()
        try receipt.close()
        data = try Data(contentsOf: URL(fileURLWithPath: receiptPath))
    } else {
        data = output.fileHandleForReading.readDataToEndOfFile()
        task.waitUntilExit()
    }
    let text = String(decoding: data, as: UTF8.self)
    guard task.terminationStatus == 0 else {
        throw Failure("\(path) \(args.joined(separator: " ")): \(text.trimmingCharacters(in: .whitespacesAndNewlines))")
    }
    return text
    #endif
}

func secureDirectory() throws {
    guard geteuid() == 0 else { throw Failure("This command requires sudo.") }
    if !fm.fileExists(atPath: directory) {
        try fm.createDirectory(atPath: directory, withIntermediateDirectories: false,
                               attributes: [.posixPermissions: 0o700])
    }
    var info = stat()
    guard lstat(directory, &info) == 0, info.st_uid == 0,
          (info.st_mode & S_IFMT) == S_IFDIR, (info.st_mode & 0o077) == 0 else {
        throw Failure("Unsafe state directory: \(directory)")
    }
}

var lockFD: Int32 = -1
func acquireLock() throws {
    try secureDirectory()
    lockFD = open(directory + "/lock", O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard lockFD >= 0, flock(lockFD, LOCK_EX | LOCK_NB) == 0 else {
        throw Failure("Another ethernetshared process is running. Stop the launch daemon before recovery.")
    }
}

struct Snapshot: Codable {
    var interface: String
    var boot: String
    var forwarding: Int
    var sleepDisabled: Int
    var address = false
    var rules = false
    var forwardingChanged = false
    var sleepChanged = false
    var token: String?
}

func save(_ state: Snapshot) throws {
    try JSONEncoder().encode(state).write(to: URL(fileURLWithPath: statePath), options: .atomic)
    try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: statePath)
}

func loadState() throws -> Snapshot? {
    guard fm.fileExists(atPath: statePath) else { return nil }
    let state = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: URL(fileURLWithPath: statePath)))
    guard validInterface(state.interface), [0, 1].contains(state.forwarding),
          [0, 1].contains(state.sleepDisabled),
          state.token == nil || state.token!.allSatisfy(\.isNumber) else {
        throw Failure("Invalid recovery state; refusing to change system settings.")
    }
    return state
}

func validateConfiguration(mac: String = ethernetMAC, upstream: String = wifi) throws {
    let bytes = mac.split(separator: ":", omittingEmptySubsequences: false)
    guard bytes.count == 6, bytes.allSatisfy({ $0.count == 2 && UInt8($0, radix: 16) != nil }),
          mac != "00:00:00:00:00:00", mac != "ff:ff:ff:ff:ff:ff",
          let first = UInt8(bytes[0], radix: 16), first & 1 == 0,
          validInterface(upstream) else {
        throw Failure("Configure a unicast Ethernet MAC address and upstream interface in Configuration.local.swift, then rebuild. See README.")
    }
}

func validInterface(_ name: String) -> Bool {
    name.hasPrefix("en") && name.count > 2 && name.dropFirst(2).allSatisfy(\.isNumber)
}

func storeValue(_ key: String) -> [String: Any]? {
    SCDynamicStoreCopyValue(nil, key as CFString) as? [String: Any]
}

func registryValue(_ service: io_registry_entry_t, _ key: String) -> Any? {
    IORegistryEntryCreateCFProperty(service, key as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
}

func lidClosed() -> Bool {
    #if TESTING
    return testLidClosed
    #else
    let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPMrootDomain"))
    guard service != 0 else { return false }
    defer { IOObjectRelease(service) }
    return registryValue(service, "AppleClamshellState") as? Bool == true
    #endif
}

func acPower() -> Bool {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue() else { return false }
    return IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() as String? == "AC Power"
}

func matchingAdapter() -> String? {
    #if TESTING
    return testMatchingAdapter
    #else
    guard let interfaces = SCNetworkInterfaceCopyAll() as? [SCNetworkInterface] else { return nil }
    let matches = interfaces.filter {
        SCNetworkInterfaceGetInterfaceType($0) == kSCNetworkInterfaceTypeEthernet &&
        (SCNetworkInterfaceGetHardwareAddressString($0) as String?)?.lowercased() == ethernetMAC
    }
    guard matches.count == 1, let name = SCNetworkInterfaceGetBSDName(matches[0]) as String?,
          validInterface(name), name != wifi else { return nil }
    return name
    #endif
}

struct Conditions: Equatable {
    var interface: String?
    var ac: Bool
    var link: Bool
    var upstream: Bool
    var paused: Bool
    var lidClosed: Bool
    var ready: Bool { interface != nil && link && upstream && !paused }
}

func conditions() -> Conditions {
    let interface = matchingAdapter()
    let primary = storeValue("State:/Network/Global/IPv4")?["PrimaryInterface"] as? String
    let addresses = storeValue("State:/Network/Interface/\(wifi)/IPv4")?["Addresses"] as? [String] ?? []
    return Conditions(interface: interface, ac: acPower(),
                      link: interface.flatMap { storeValue("State:/Network/Interface/\($0)/Link")?["Active"] as? Bool } == true,
                      upstream: primary == wifi && addresses.contains { !$0.hasPrefix("169.254.") },
                      paused: pausedForCurrentBoot(), lidClosed: lidClosed())
}

func disabledSleep() throws -> Int {
    let text = try run("/usr/bin/pmset", ["-g"])
    for line in text.split(separator: "\n") {
        let fields = line.split(whereSeparator: \.isWhitespace)
        if fields.first == "SleepDisabled", fields.count == 2, let value = Int(fields[1]) { return value }
    }
    throw Failure("Cannot read SleepDisabled; refusing to guess the original value.")
}

func bootID() throws -> String {
    try run("/usr/sbin/sysctl", ["-n", "kern.boottime"]).trimmingCharacters(in: .whitespacesAndNewlines)
}

func pauseForCurrentBoot() throws {
    guard let data = (try bootID() + "\n").data(using: .utf8) else {
        throw Failure("Cannot encode the current boot identifier.")
    }
    try data.write(to: URL(fileURLWithPath: pausedPath), options: .atomic)
    try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: pausedPath)
}

func pausedForCurrentBoot() -> Bool {
    guard fm.fileExists(atPath: pausedPath) else { return false }
    guard let current = try? bootID(),
          let data = try? Data(contentsOf: URL(fileURLWithPath: pausedPath)),
          let marker = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) else {
        // A failure to validate pause state must fail closed for this evaluation.
        return true
    }
    if marker == current { return true }
    if marker.isEmpty {
        // Migrate the old persistent marker: honor it for this boot only.
        try? pauseForCurrentBoot()
        return true
    }
    do {
        try fm.removeItem(atPath: pausedPath)
        log("Expired manual pause from an earlier boot; automatic sharing enabled.")
        return false
    } catch {
        log("ERROR: Cannot remove expired pause marker: \(error)")
        return true
    }
}

func pfRules(_ interface: String) -> String {
    """
    nat on \(wifi) inet from \(clientIP)/32 to any -> (\(wifi))
    block drop in quick on \(interface) inet from ! \(clientIP) to any
    block drop in quick on \(interface) inet from any to self
    pass in quick on \(interface) inet from \(clientIP) to any keep state
    pass out quick on \(wifi) inet from \(clientIP) to any keep state
    block drop quick on \(interface) inet6 all
    """ + "\n"
}

func parseToken(_ output: String) -> String? {
    for line in output.split(separator: "\n") {
        let parts = line.split(whereSeparator: \.isWhitespace)
        if parts.count == 3, parts[0] == "Token", parts[1] == ":", parts[2].allSatisfy(\.isNumber) {
            return String(parts[2])
        }
    }
    return nil
}

func checkAnchors() throws {
    let nat = try run("/sbin/pfctl", ["-sn"])
    let filter = try run("/sbin/pfctl", ["-sr"])
    guard nat.contains("nat-anchor \"com.apple/*\""), filter.contains("anchor \"com.apple/*\"") else {
        throw Failure("The active PF root rules lack Apple's com.apple/* hooks. No rules were replaced. Restore the normal PF configuration during migration first; see README.")
    }
}

func start(_ interface: String) throws {
    try checkAnchors()
    let forwarding = Int(try run("/usr/sbin/sysctl", ["-n", "net.inet.ip.forwarding"]).trimmingCharacters(in: .whitespacesAndNewlines))
    guard forwarding == 0 else { throw Failure("IPv4 forwarding already enabled; another sharing service or legacy session may own it.") }
    let disabled = try disabledSleep()
    guard disabled == 0 else { throw Failure("SleepDisabled already enabled; restore the legacy session before enabling automatic sharing.") }
    let current = try run("/sbin/ifconfig", [interface])
    let addresses = current.split(separator: "\n").map { $0.split(whereSeparator: \.isWhitespace) }
    guard !addresses.contains(where: { $0.first == "inet" && $0.count > 1 && !$0[1].hasPrefix("169.254.") }) else {
        throw Failure("Adapter has a non-link-local IPv4 address; refusing to replace another network configuration.")
    }
    let routes = try run("/usr/sbin/netstat", ["-rn", "-f", "inet"])
    guard !routes.split(separator: "\n").contains(where: {
        let fields = $0.split(whereSeparator: \.isWhitespace)
        return fields.first == "192.168.2" || fields.first == "192.168.2/24" || fields.first == "192.168.2.0/24"
    }) else { throw Failure("192.168.2.0/24 overlaps an existing route.") }
    let rules = pfRules(interface)
    try run("/sbin/pfctl", ["-a", anchor, "-nf", "-"], input: rules)
    var state = Snapshot(interface: interface, boot: try bootID(), forwarding: 0, sleepDisabled: disabled)
    try save(state)
    // Journal intent BEFORE changing any setting. Recovery is safe if an action never ran.
    state.address = true; try save(state)
    try run("/sbin/ifconfig", [interface, "inet", gateway, "netmask", "255.255.255.0", "alias"])
    state.rules = true; try save(state)
    try run("/sbin/pfctl", ["-a", anchor, "-f", "-"], input: rules)
    let enable = try run("/sbin/pfctl", ["-E"])
    guard let token = parseToken(enable) else { throw Failure("PF enabled but no reference token was returned. Inspect pfctl -s References before retrying.") }
    state.token = token; try save(state)
    state.forwardingChanged = true; try save(state)
    try run("/usr/sbin/sysctl", ["-w", "net.inet.ip.forwarding=1"])
    state.sleepChanged = true; try save(state)
    // This is system-wide despite -c in the legacy script. It is restored when sharing stops.
    try run("/usr/bin/pmset", ["disablesleep", "1"])
    guard try disabledSleep() == 1 else { throw Failure("macOS did not accept the lid-sleep override.") }
    log("SHARING started interface=\(interface) client=\(clientIP) power-policy=AC-or-battery")
}

// Attempt every cleanup step even when one fails. Retain the journal for retries.
func cleanup(sleepAfter: Bool) throws {
    guard let state = try loadState() else { return }
    let sameBoot = try bootID() == state.boot
    var errors: [String] = []
    func attempt(_ operation: () throws -> Void) {
        do { try operation() } catch { errors.append(String(describing: error)) }
    }
    if sameBoot {
        if state.rules {
            attempt { try run("/sbin/pfctl", ["-a", anchor, "-f", "-"], input: "") }
            // Do not flush the system state table. Kill only client device-originated flows.
            attempt { try run("/sbin/pfctl", ["-k", clientIP]) }
        }
        if state.forwardingChanged {
            attempt { try run("/usr/sbin/sysctl", ["-w", "net.inet.ip.forwarding=\(state.forwarding)"]) }
        }
        if state.address, matchingAdapter() == state.interface,
           (try? run("/sbin/ifconfig", [state.interface]))?.contains("inet \(gateway) ") == true {
            attempt { try run("/sbin/ifconfig", [state.interface, "inet", gateway, "-alias"]) }
        }
        let receiptToken = (try? String(contentsOfFile: receiptPath, encoding: .utf8)).flatMap(parseToken)
        if let token = state.token ?? receiptToken {
            // Release can already have succeeded during a previous partial cleanup.
            attempt {
                let refs = try run("/sbin/pfctl", ["-s", "References"])
                if refs.split(whereSeparator: { !$0.isNumber }).contains(Substring(token)) {
                    try run("/sbin/pfctl", ["-X", token])
                }
            }
        }
    }
    // pmset is persistent, unlike interface/PF/sysctl state: restore across boots too.
    if state.sleepChanged {
        attempt {
            try run("/usr/bin/pmset", ["disablesleep", String(state.sleepDisabled)])
            guard try disabledSleep() == state.sleepDisabled else { throw Failure("SleepDisabled restoration did not take effect") }
        }
    }
    guard errors.isEmpty else { throw Failure("Cleanup incomplete; journal retained: " + errors.joined(separator: "; ")) }
    if fm.fileExists(atPath: receiptPath) { try fm.removeItem(atPath: receiptPath) }
    try fm.removeItem(atPath: statePath)
    log("SHARING stopped settings-restored=true")
    if sleepAfter && state.sleepDisabled == 0 && lidClosed() {
        log("SLEEP requested reason=lid-closed-after-sharing-stop")
        try run("/usr/bin/pmset", ["sleepnow"])
    }
}

var observing = false
var active = false
var lastConditions: Conditions?
var cooldown = Date.distantPast
var watchingReady = false

// Process.waitUntilExit can service the main run loop. Network changes produced by
// start/cleanup may therefore call reconcile again before the current pass returns.
// Coalesce those callbacks into one subsequent pass instead of nesting mutations.
final class SerialCoalescer {
    private var running = false
    private var pending = false

    func perform(_ operation: () -> Void) {
        if running {
            pending = true
            return
        }
        running = true
        repeat {
            pending = false
            operation()
        } while pending
        running = false
    }
}

let reconcileGate = SerialCoalescer()

func stateDescription(_ status: Conditions) -> String {
    "STATE adapter=\(status.interface.map { "connected(\($0))" } ?? "disconnected") " +
        "ethernet=\(status.link ? "up" : "down") power=\(status.ac ? "AC" : "battery") " +
        "wifi=\(status.upstream ? "ready" : "unavailable") lid=\(status.lidClosed ? "closed" : "open") " +
        "automation=\(status.paused ? "paused" : "enabled")"
}

func stopReasons(_ status: Conditions) -> String {
    var reasons: [String] = []
    if status.interface == nil { reasons.append("adapter-removed") }
    else if !status.link { reasons.append("ethernet-link-down") }
    if !status.upstream { reasons.append("wifi-unavailable") }
    if status.paused { reasons.append("manual-pause") }
    return reasons.isEmpty ? "session-drift" : reasons.joined(separator: ",")
}

func sessionHealthy(_ state: Snapshot, _ status: Conditions) throws -> Bool {
    guard status.interface == state.interface else { return false }
    let address = try run("/sbin/ifconfig", [state.interface])
    let forwarding = try run("/usr/sbin/sysctl", ["-n", "net.inet.ip.forwarding"])
    let nat = try run("/sbin/pfctl", ["-a", anchor, "-sn"])
    let sleep = try disabledSleep()
    return address.contains("inet \(gateway) ") && forwarding.trimmingCharacters(in: .whitespacesAndNewlines) == "1" &&
        nat.contains(clientIP) && sleep == 1
}

func reconcilePass() {
    let status = conditions()
    if status != lastConditions {
        log(stateDescription(status))
        lastConditions = status
    }
    if observing { return }
    do {
        var healthy = true
        if active, status.ready {
            if let state = try loadState() { healthy = (try? sessionHealthy(state, status)) == true }
            else { throw Failure("Active session journal is missing; manual recovery is required.") }
        }
        if active && (!status.ready || !healthy) {
            active = false
            log("SHARING stop-trigger reason=\(healthy ? stopReasons(status) : "session-drift")")
            if !healthy { cooldown = Date().addingTimeInterval(60) }
            try cleanup(sleepAfter: true)
        }
        if !active {
            // Startup/crash recovery happens even while paused or adapter absent.
            if try loadState() != nil { try cleanup(sleepAfter: !status.ready) }
            if status.ready, Date() >= cooldown, let interface = status.interface {
                do {
                    log("SHARING start-trigger reason=all-conditions-ready interface=\(interface)")
                    try start(interface)
                    active = true
                } catch {
                    cooldown = Date().addingTimeInterval(60)
                    try? cleanup(sleepAfter: true)
                    throw error
                }
            }
        }
    } catch { log("ERROR: \(error)") }
}

func reconcile() {
    reconcileGate.perform(reconcilePass)
}

// All callbacks and actions run on the main run loop: no concurrent start/stop.
func devicesChanged(_ context: UnsafeMutableRawPointer?, _ iterator: io_iterator_t) {
    while true {
        let object = IOIteratorNext(iterator)
        if object == 0 { break }
        IOObjectRelease(object)
    }
    if watchingReady { reconcile() }
}

func watch() throws {
    if !observing {
        try acquireLock()
        // Restore power settings even if notification registration later fails.
        try cleanup(sleepAfter: false)
    }
    guard let port = IONotificationPortCreate(kIOMainPortDefault),
          let source = IONotificationPortGetRunLoopSource(port)?.takeUnretainedValue() else { throw Failure("Cannot create IOKit notifications") }
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .defaultMode)
    var added: io_iterator_t = 0
    var removed: io_iterator_t = 0
    guard IOServiceAddMatchingNotification(port, kIOFirstMatchNotification, IOServiceMatching("IOEthernetInterface"), devicesChanged, nil, &added) == KERN_SUCCESS,
          IOServiceAddMatchingNotification(port, kIOTerminatedNotification, IOServiceMatching("IOEthernetInterface"), devicesChanged, nil, &removed) == KERN_SUCCESS else { throw Failure("Cannot watch Ethernet devices") }
    // Drain to arm both notifications. Startup scan also handles already-connected devices.
    devicesChanged(nil, added)
    devicesChanged(nil, removed)
    guard let store = SCDynamicStoreCreate(nil, "ethernetshare" as CFString, { _, _, _ in reconcile() }, nil),
          SCDynamicStoreSetNotificationKeys(store, nil, ["State:/Network/.*"] as CFArray),
          let networkSource = SCDynamicStoreCreateRunLoopSource(nil, store, 0) else { throw Failure("Cannot watch network changes") }
    CFRunLoopAddSource(CFRunLoopGetMain(), networkSource, .defaultMode)
    if let powerSource = IOPSNotificationCreateRunLoopSource({ _ in reconcile() }, nil)?.takeRetainedValue() {
        CFRunLoopAddSource(CFRunLoopGetMain(), powerSource, .defaultMode)
    } else { throw Failure("Cannot watch power source changes") }
    // A normal timer does NOT wake a sleeping Mac. Covers wake and missed events.
    let timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { _ in reconcile() }
    timer.tolerance = 1
    var signalSources: [DispatchSourceSignal] = []
    for sig in [SIGTERM, SIGINT, SIGUSR1] {
        signal(sig, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
        source.setEventHandler {
            if sig == SIGUSR1 { reconcile(); return }
            if !observing {
                do { try cleanup(sleepAfter: false) }
                catch { log("ERROR: \(error)"); exit(1) }
            }
            exit(0)
        }
        source.resume()
        signalSources.append(source)
    }
    watchingReady = true
    log("DAEMON ready pid=\(getpid()) poll-interval=10s")
    reconcile()
    withExtendedLifetime((port, store, timer, signalSources)) { CFRunLoopRun() }
}

func selfTest() throws {
    func check(_ value: Bool, _ message: String) throws { if !value { throw Failure(message) } }
    try validateConfiguration(mac: "02:00:00:00:00:01", upstream: "en1")
    for invalid in ["", "00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff", "01:00:00:00:00:01", "02:00:00:00:00:zz", "02:00:00:00:00:001"] {
        var rejected = false
        do { try validateConfiguration(mac: invalid, upstream: "en0") } catch { rejected = true }
        try check(rejected, "Invalid adapter configuration must be rejected")
    }
    var rejectedUpstream = false
    do { try validateConfiguration(mac: "02:00:00:00:00:01", upstream: "en0;shutdown") }
    catch { rejectedUpstream = true }
    try check(rejectedUpstream, "Invalid upstream configuration must be rejected")
    try check(parseToken("pf enabled\nToken : 123456789\n") == "123456789", "PF token parser")
    try check(parseToken("Token : not-a-token") == nil, "Reject invalid token")
    try check(validInterface("en9") && !validInterface("en9;shutdown") && !validInterface("en"), "Interface validation")
    for mask in 0..<32 {
        let c = Conditions(interface: mask & 1 != 0 ? "en9" : nil, ac: mask & 2 != 0,
                           link: mask & 4 != 0, upstream: mask & 8 != 0,
                           paused: mask & 16 != 0, lidClosed: false)
        let expected = mask & 1 != 0 && mask & 4 != 0 && mask & 8 != 0 && mask & 16 == 0
        try check(c.ready == expected, "Start policy truth table \(mask)")
    }
    let original = Snapshot(interface: "en9", boot: "example", forwarding: 0, sleepDisabled: 0, sleepChanged: true)
    let restored = try JSONDecoder().decode(Snapshot.self, from: JSONEncoder().encode(original))
    try check(restored.sleepChanged && restored.interface == "en9", "Recovery journal round trip")
    let rules = pfRules("en9")
    try check(!rules.contains("pass quick on en0 all") && rules.contains("192.168.2.2/32"), "Narrow PF policy")
    let closed = Conditions(interface: "en9", ac: true, link: true, upstream: true, paused: false, lidClosed: true)
    try check(stateDescription(closed).contains("lid=closed"), "Lid state logging")
    let battery = Conditions(interface: "en9", ac: false, link: true, upstream: true, paused: false, lidClosed: true)
    try check(battery.ready && !stopReasons(battery).contains("AC"), "Battery power must allow and preserve sharing")
    try check(stopReasons(Conditions(interface: nil, ac: true, link: false, upstream: true, paused: false, lidClosed: true)) == "adapter-removed", "Adapter removal reason")
    let gate = SerialCoalescer()
    var reconciliationPasses = 0
    gate.perform {
        reconciliationPasses += 1
        if reconciliationPasses == 1 {
            gate.perform { reconciliationPasses += 100 }
            gate.perform { reconciliationPasses += 100 }
        }
    }
    try check(reconciliationPasses == 2, "Reentrant reconciliation must coalesce into one later pass")
    print("Passed: 32 policy combinations, token parsing, interface validation, journal round trip, PF scope.")
    #if TESTING
    try recoveryTests()
    #endif
}

#if TESTING
func recoveryTests() throws {
    try fm.createDirectory(atPath: directory, withIntermediateDirectories: false)
    defer { try? fm.removeItem(atPath: directory) }
    var calls: [String] = []
    var fault: String?
    var sleep = 0
    var forward = 0
    var ip = false
    var rules = false
    var token = false
    var currentBoot = "boot-one"
    commandOverride = { path, args, input in
        let call = path + " " + args.joined(separator: " ")
        calls.append(call)
        if fault == call { fault = nil; throw Failure("Injected failure: \(call)") }
        switch call {
        case "/sbin/pfctl -sn": return "nat-anchor \"com.apple/*\" all\n"
        case "/sbin/pfctl -sr": return "anchor \"com.apple/*\" all\n"
        case "/usr/sbin/sysctl -n net.inet.ip.forwarding": return String(forward)
        case "/usr/sbin/sysctl -n kern.boottime": return currentBoot
        case "/usr/bin/pmset -g": return "System-wide power settings:\n SleepDisabled \(sleep)\n"
        case "/usr/sbin/netstat -rn -f inet": return "default 192.168.32.1 en0\n"
        case "/sbin/ifconfig en9": return ip ? "inet 192.168.2.1 netmask 0xffffff00" : "inet 169.254.1.2 netmask 0xffff0000"
        case "/sbin/ifconfig en9 inet 192.168.2.1 netmask 255.255.255.0 alias": ip = true
        case "/sbin/ifconfig en9 inet 192.168.2.1 -alias": ip = false
        case "/sbin/pfctl -a com.apple/ethernetshare -nf -": break
        case "/sbin/pfctl -a com.apple/ethernetshare -f -": rules = !(input ?? "").isEmpty
        case "/sbin/pfctl -E": token = true; return "Token : 123456\n"
        case "/sbin/pfctl -s References": return token ? "Token : 123456\n" : ""
        case "/sbin/pfctl -X 123456": token = false
        case "/sbin/pfctl -k 192.168.2.2": break
        case "/usr/sbin/sysctl -w net.inet.ip.forwarding=1": forward = 1
        case "/usr/sbin/sysctl -w net.inet.ip.forwarding=0": forward = 0
        case "/usr/bin/pmset disablesleep 1": sleep = 1
        case "/usr/bin/pmset disablesleep 0": sleep = 0
        case "/usr/bin/pmset sleepnow": break
        default: throw Failure("Unexpected test command: \(call)")
        }
        return ""
    }
    func assert(_ value: Bool, _ message: String) throws { if !value { throw Failure(message) } }
    try start("en9")
    try assert(ip && rules && token && forward == 1 && sleep == 1, "Start did not configure sharing")
    try cleanup(sleepAfter: false)
    try assert(!ip && !rules && !token && forward == 0 && sleep == 0, "Normal cleanup failed")
    let count = calls.count
    try cleanup(sleepAfter: false)
    try assert(calls.count == count, "Repeated cleanup must be a no-op")
    for failure in ["/sbin/ifconfig en9 inet 192.168.2.1 netmask 255.255.255.0 alias", "/sbin/pfctl -a com.apple/ethernetshare -f -", "/sbin/pfctl -E", "/usr/sbin/sysctl -w net.inet.ip.forwarding=1", "/usr/bin/pmset disablesleep 1"] {
        fault = failure
        do { try start("en9"); throw Failure("Fault was not exercised") }
        catch { try assert(fault == nil, "Wrong failure in start") }
        try cleanup(sleepAfter: false)
        try assert(!ip && !rules && !token && forward == 0 && sleep == 0, "Partial-start cleanup failed")
    }
    try start("en9")
    fault = "/usr/sbin/sysctl -w net.inet.ip.forwarding=0"
    do { try cleanup(sleepAfter: false); throw Failure("Missing cleanup failure") }
    catch { try assert(fault == nil, "Wrong cleanup error") }
    try assert(sleep == 0 && fm.fileExists(atPath: statePath), "Restore sleep despite network failure, retain journal")
    try cleanup(sleepAfter: false)
    try assert(forward == 0 && !fm.fileExists(atPath: statePath), "Cleanup retry failed")
    try start("en9")
    testLidClosed = true
    try cleanup(sleepAfter: true)
    try assert(calls.last == "/usr/bin/pmset sleepnow" && sleep == 0 && forward == 0 && !rules, "Closed lid must sleep only AFTER network and power cleanup")
    testLidClosed = false
    try start("en9")
    let openLidCount = calls.count
    try cleanup(sleepAfter: true)
    try assert(!calls.dropFirst(openLidCount).contains("/usr/bin/pmset sleepnow"), "Open lid must not force sleep")
    // Critical battery can resume from hibernation without changing the boot ID.
    // If the adapter was removed while powered down, cleanup must still restore
    // PF, forwarding and sleep state; the vanished interface needs no alias removal.
    try start("en9")
    testMatchingAdapter = nil
    let hibernationCount = calls.count
    try cleanup(sleepAfter: false)
    let hibernationCalls = calls.dropFirst(hibernationCount)
    try assert(!rules && !token && forward == 0 && sleep == 0 && !fm.fileExists(atPath: statePath), "Same-boot power-loss recovery with adapter absent failed")
    try assert(!hibernationCalls.contains("/sbin/ifconfig en9 inet 192.168.2.1 -alias"), "Absent adapter must not receive an alias-removal command")
    // Model the hardware removal discarding the interface and its addresses.
    ip = false
    testMatchingAdapter = "en9"
    // Simulate death after pfctl returned a token but before JSON saved it.
    try start("en9")
    var interrupted = try loadState()!
    interrupted.token = nil
    try save(interrupted)
    try Data("Token : 123456\n".utf8).write(to: URL(fileURLWithPath: receiptPath))
    try cleanup(sleepAfter: false)
    try assert(!token && !fm.fileExists(atPath: receiptPath), "PF receipt crash recovery failed")
    // Simulate an abrupt critical-battery shutdown. The adapter is then removed while
    // the Mac is off, so the next boot gets no removal event. Recovery must restore
    // the persistent sleep override without touching stale per-boot network/PF state.
    try start("en9")
    currentBoot = "boot-two"
    testMatchingAdapter = nil
    let rebootCount = calls.count
    try cleanup(sleepAfter: false)
    try assert(sleep == 0 && !fm.fileExists(atPath: statePath), "Power-loss recovery did not restore sleep and clear its journal")
    try assert(!calls.dropFirst(rebootCount).contains { $0.contains("pfctl") || $0.contains("ifconfig") || $0.contains("-w net.inet") }, "Reboot recovery touched new boot network state")
    testMatchingAdapter = "en9"
    try assert(!calls.contains { $0 == "/sbin/pfctl -d" || $0.hasPrefix("/sbin/pfctl -f") }, "Global PF mutation")
    try pauseForCurrentBoot()
    try assert(pausedForCurrentBoot(), "Manual pause must apply during the current boot")
    currentBoot = "boot-three"
    try assert(!pausedForCurrentBoot() && !fm.fileExists(atPath: pausedPath), "Manual pause must expire after reboot")
    try Data().write(to: URL(fileURLWithPath: pausedPath))
    try assert(pausedForCurrentBoot(), "Legacy empty pause marker must be honored during migration")
    try assert((try String(contentsOfFile: pausedPath, encoding: .utf8)).contains("boot-three"), "Legacy pause marker was not migrated")
    print("Passed: start/stop, idempotence, 5 partial-start failures, cleanup retry, closed/open lid, token receipt, boot-scoped pause and critical-battery hibernation/reboot recovery.")
}
#endif

do {
    let command = CommandLine.arguments.dropFirst().first ?? "status"
    switch command {
    case "check-config": try validateConfiguration(); print("Configuration is valid.")
    case "watch": try validateConfiguration(); try watch()
    case "observe": try validateConfiguration(); observing = true; try watch()
    case "self-test": try selfTest()
    case "process-test":
        let output = try run("/usr/bin/printf", ["ethernetshare-process-ok"])
        guard output == "ethernetshare-process-ok" else { throw Failure("Child process output/EOF test failed") }
        print("Passed: child process output and EOF handling.")
    case "rules": print(pfRules("en9"), terminator: "")
    case "status":
        let c = conditions()
        print("Adapter: \(c.interface ?? "absent"), AC: \(c.ac), link: \(c.link), Wi-Fi upstream: \(c.upstream), lid closed: \(c.lidClosed)")
        if geteuid() == 0 {
            try secureDirectory()
            print("Paused: \(c.paused), recovery/session state: \(try loadState() != nil)")
            print(try run("/usr/bin/pmset", ["-g"]))
            print(try run("/sbin/pfctl", ["-a", anchor, "-sn"]))
        } else { print("Use sudo for session, pause and PF status.") }
    case "start", "stop":
        try secureDirectory()
        if command == "stop" { try pauseForCurrentBoot() }
        else if fm.fileExists(atPath: pausedPath) { try fm.removeItem(atPath: pausedPath) }
        try run("/bin/launchctl", ["kill", "SIGUSR1", "system/local.ethernetshare"])
        print(command == "stop" ? "Paused for this boot; daemon will clean up. Reboot or run start to resume automatic sharing." : "Automatic sharing resumed; waiting for adapter and Wi-Fi.")
    case "recover": try acquireLock(); try cleanup(sleepAfter: false)
    default: throw Failure("Usage: ethernetshared {check-config|watch|observe|status|start|stop|recover|self-test|process-test|rules}")
    }
} catch {
    log("ERROR: \(error)")
    exit(1)
}
