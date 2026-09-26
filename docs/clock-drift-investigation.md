# PS5 power-cycle address-conflict investigation

The installed service was inspected while the Ethernet adapter remained plugged
in and the client could still reach the internet. Read-only evidence showed:

- The Ethernet link and configured Wi-Fi upstream were ready.
- The adapter retained the project's gateway address, while its macOS network
  service remained configured for DHCP with a separate link-local address.
- The project's own PF anchor still contained the client's NAT/filter rules,
  and IPv4 forwarding was enabled.
- The network recovery/session journal was absent.
- Earlier logs said `SHARING stopped settings-restored=true` on link-down, then
  reported `Adapter has a non-link-local IPv4 address` on the next link-up.
- Two reads of `kern.boottime` in the same boot had identical seconds but
  different microseconds. `kern.bootsessionuuid` stayed unchanged.

## Root cause and reproduction

The old `cleanup` compared the entire wall-clock-derived boot timestamp with the
journal's timestamp. When it differed, cleanup assumed a reboot, skipped all
per-boot network teardown, and removed the journal. Existing NAT and addresses
could continue serving the client, so connectivity did not prove service health.

A TESTING build of the previous source was given a microsecond-only clock change
between `start` and `cleanup`. It reproduced the exact invariant violation:
cleanup logged successful restoration and discarded the journal, but the simulated
address, PF rules, token, and forwarding remained enabled. No real network changes
were made by that reproduction.

## Fix and validation

New journal and pause records use the validated, normalized kernel boot-session
UUID. The installer writes the same format for a fresh installation's pause.
Migration accepts old records with matching boot seconds without comparing their
microseconds or date suffix. Ambiguous legacy records fail closed: network intent
is retained, persistent sleep restoration is still attempted, and an ambiguous
pause does not expire without an explicit start.

The regression suite now covers microsecond and whole-second clock corrections,
legacy journal and pause migration, ambiguous record preservation, invalid kernel
identity, genuine reboot cleanup, and pause expiry after a genuine reboot. The
complete Swift/shell/plist/PF test suite passed after the change.

The already-running service was not restarted or its untracked rules erased during
this investigation, to preserve the working client connection. Source changes do
not replace a running installed binary. A controlled installation and reboot when
the client is idle is required to both deploy the fix and clear state whose
journal was already lost. Automatic adoption would require guessing ownership
and the missing original recovery values, so this fix does not do that.
