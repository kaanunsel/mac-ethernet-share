// Copy to Configuration.local.swift and replace the empty MAC address.
// Find hardware addresses and interface names with: networksetup -listallhardwareports
// Stop and uninstall the old service before changing configuration.
enum Configuration {
    static let ethernetMAC = ""
    static let upstreamInterface = "en0"
}
