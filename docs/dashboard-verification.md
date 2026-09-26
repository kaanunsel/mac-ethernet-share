# Dashboard verification

The local dashboard was built and inspected using the Codex in-app browser.
The Image Gen concept is retained locally at `.build/dashboard-concept.png` and
the final browser preview at `.build/dashboard-preview.png`. These images are
excluded from Git because the live preview contains machine-specific information.
Both images were opened with `view_image` for a direct comparison.

## Visual fidelity ledger

| Comparison | Result / intentional difference |
| --- | --- |
| Layout | Preserved sidebar, connection map, four metrics, traffic/control split, details/activity split. Added a necessary warning when forwarding has no session journal. |
| Typography | Preserved system sans-serif hierarchy and compact UI chrome; increased the main heading to match the concept. |
| Palette | White panels, cool light background, navy text, teal connection states, blue upload series; amber indicates a real recovery warning. |
| Component geometry | Shared borders, radii, spacing, panel headers, buttons, labels, and key/value rows. Reduced graph height to balance the desktop layout. |
| Icons | Code-native outline network, Wi-Fi, laptop, Ethernet, power, and service-control icons. No screenshot is used as UI. |
| Copy/data | Replaced illustrative IPs, device labels, fake throughput, session totals, and invented events with real values. Corrected upload direction and automation semantics. Added configured-address labels and unknown/protected states. |
| Responsive | Checked 1536×1024 desktop and 390×844 mobile. Fixed a 14-pixel mobile navigation overflow; document width then matched viewport width. Increased mobile graph-label size. |

The concept's information hierarchy and visual system were faithfully implemented
and verified. Intentional deviations are the real-state warning, live graph values,
corrected product semantics, and the expanded configuration/diagnostics workflows.
The copy comparison found no unexplained marketing copy or invented live metrics.
No remaining accidental clipping or horizontal overflow was observed. The warning
and multiline real logs can move lower panels below the first viewport.

## Functional checks

- Production Vite build passed.
- Swift build, policy and recovery tests, shell/plist checks, and PF syntax checks passed.
- Dashboard unit tests cover adapter validation, counter parsing, traffic direction,
  resets, and hardware inventory.
- Live API tests cover private browser access, missing cookies/tokens, Host/Origin
  and cross-site rejection, malformed JSON, unknown actions, and invalid configuration.
- Native administrator authorization started the protected helper. Switched its
  startup to launchd after a background shell process failed to remain running;
  success is now reported only after the helper responds.
- Paused and resumed automation through the UI, then restored enabled automation.
- Verified configuration edit/reset without applying a different physical adapter.
- Verified navigation, live updates, log text/error filtering, diagnostic state,
  protected PF output, and disabled restart while the adapter is attached.
- Browser console reported no application errors in the final production build.
- Listener verified as `127.0.0.1:3847`; login launch-agent plist validated.

A real adapter/upstream replacement was not performed because the active connection
was in use. Export buttons use browser Blob downloads; the in-app browser's download
event did not complete during verification, so file delivery is not asserted for
that embedded browser. Ordinary desktop-browser download handling should be checked
when using exports there. No external Playwright browser fallback was used.
