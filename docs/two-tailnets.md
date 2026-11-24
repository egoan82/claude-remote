# Two tailnets on one computer: work + personal

*[Leer en español](two-tailnets.es.md)*

Use this guide when your computer is **already connected to another organization's tailnet** (for example, your
employer's) and you want claude-remote on your **personal** tailnet, where your phone is, without disconnecting
from the first one.

## The problem

- The Tailscale client keeps **one active profile at a time**. `tailscale switch` moves between accounts, but it
  cannot keep both connected.
- While the work tailnet is active, your phone (on your personal tailnet) cannot reach the computer, so the PWA
  does not load.
- claude-remote only needs the personal tailnet to **reach into** the computer: `tailscale serve` proxies
  `https://<computer>.<tailnet>.ts.net` to `127.0.0.1:7681`. The computer does not need to reach other personal
  devices.

## The solution: a second `tailscaled` in userspace mode

```
Phone ──personal tailnet──▶ tailscaled-personal (userspace, own socket) ──serve──▶ 127.0.0.1:7681
                            tailscaled (system, TUN) ──▶ work tailnet (no serve)
```

- [`tailscaled-personal.service`](../tailscaled-personal.service) is a system unit that runs
  `tailscaled --tun=userspace-networking` with its own:
  - state in `/var/lib/tailscale-personal`
  - socket at `/run/tailscale-personal/tailscaled.sock`
  - UDP port `41642` (the system daemon uses `41641`)
- In userspace mode it creates no network interface and changes neither DNS nor routes, so it does not clash with
  the system daemon. `tailscale serve` still works because the daemon itself does the proxying to localhost.
- [`bin/tsp`](../bin/tsp) is `tailscale` pointed at the personal socket: `tsp status`, `tsp ip -4`,
  `tsp serve status`, and so on.
- `make serve`, `make unserve` and `make status` use the personal socket automatically when it exists. If the unit
  is installed but the daemon is not running, `make serve` fails instead of publishing the app on the work tailnet.

Nothing in claude-remote itself changes, and nothing is exposed to the internet.

> [!NOTE]
> Check your organization's policy before running a second Tailscale client on a work computer.

## Before you start

- Linux with systemd, and Tailscale installed (`/usr/sbin/tailscaled`).
- The system `tailscaled` is already logged in to the work tailnet. `tailscale status` shows it.
- Your personal tailnet has **MagicDNS** and **HTTPS Certificates** enabled (admin console → DNS).
- Your phone has the Tailscale app logged in to the personal tailnet.

## Installation (once; asks for sudo)

```sh
make install-personal-tailnet   # copies the unit to /etc/systemd/system and starts it
make personal-up                # opens a login URL: sign in with your PERSONAL account
make link-ct                    # installs ct and tsp in ~/.local/bin
tsp status                      # the computer now shows up in your personal tailnet
tsp ip -4                       # the computer's 100.x IP in the personal tailnet
```

`make personal-up` uses `$(hostname)` as the device name and makes your user the operator, so `tsp` works without
sudo afterwards. To pick another name: `make personal-up TS_HOSTNAME=my-laptop`.

Then:

1. **Allow the personal devices.** In `claude-remote.service`, set `ALLOWED_LOGINS` to your personal Tailscale
   login and `ALLOWED_IPS` to your phone's IP plus the computer's IP from `tsp ip -4` (find the phone's IP with
   `tsp status`). Apply it with `make install-service`.
2. **Publish the app:** `make serve`. It goes through the personal daemon.
3. **Check both daemons:**
   - `tsp serve status` shows `https://<computer>.<personal-tailnet>.ts.net`.
   - `tailscale serve status` (without `tsp`) must say `No serve config`. The app is not on the work tailnet.
4. **Open it on the phone:** `https://<computer>.<personal-tailnet>.ts.net`, and install the PWA.
5. **Optional:** update your personal tailnet's ACL ([example](tailscale-acl.hujson)) with the computer's new IP
   or name.

> [!WARNING]
> Never run plain `tailscale serve` (without `tsp`) for claude-remote: that publishes a shell on your computer
> on the work tailnet. Use `make serve` or `tsp serve`.

### If the computer was already on your personal tailnet

If the computer used to join the personal tailnet through the system daemon (before the work tailnet), the second
daemon registers it as a **new device** with a new IP:

1. In the personal tailnet's admin console, **remove the old device** and, if needed, rename the new one to the
   old name. That way the `*.ts.net` URL the PWA was installed from stays the same.
2. **After renaming**, run `tsp serve reset && make serve`. The `serve` config is tied to the previous name; if you
   skip this, the phone gets `no webserver configured for name/port`.
3. Replace the old IP in `ALLOWED_IPS` and in your ACL, then `make install-service`.

## Limitations

- **The computer cannot reach other personal devices directly**, because there is no TUN interface. Incoming
  connections (the phone opening the app) work. If you ever need outgoing ones, add
  `--socks5-server=localhost:1055` to `ExecStart` in the unit and use it as a proxy.
- The work tailnet is unaffected: it keeps the TUN interface, its DNS and its routes.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `make serve` says `tailscaled-personal no está corriendo` | `sudo systemctl start tailscaled-personal`, then check `systemctl status tailscaled-personal` |
| `tsp` says `access denied` | Run `make personal-up` again; it sets your user as operator |
| Phone shows `no webserver configured for name/port` | The device was renamed after `serve`: `tsp serve reset && make serve` |
| Certificate error on the phone | Enable MagicDNS and HTTPS Certificates in the **personal** tailnet's admin console |
| Requests are rejected (403) | `ALLOWED_IPS` / `ALLOWED_LOGINS` must hold the **personal** tailnet IPs and login, see `tsp status` |

## Uninstall

```sh
make unserve && make uninstall-personal-tailnet
```

The device stays listed in the personal tailnet until you remove it in the admin console. The state in
`/var/lib/tailscale-personal` stays on disk; delete it with `sudo rm -rf /var/lib/tailscale-personal` if you are
not coming back.

## Alternatives considered

| Option | Why not |
|---|---|
| `tailscale switch` between accounts | You lose the work connection every time you switch |
| Share the computer from the work tailnet to your personal account | Depends on the work tailnet's admin and ACLs, and leaves the app reachable from the work network |
| Put the phone in the work tailnet | The phone then has the same one-profile limit, and a personal device joins the work network |
| Public tunnel (e.g. Cloudflare Tunnel + Access) | A third party decrypts the TLS and sees the terminal traffic; it would also need auth changes in `server.js` |
