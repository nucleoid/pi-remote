# Networking recipes

π Remote should only be used over trusted local paths.

## LAN

Use the Pi host's LAN IP address and keep the port firewalled to the trusted network.

```json
{
  "host": "0.0.0.0",
  "port": 37891
}
```

Pair Android with the machine's LAN address, for example `192.168.1.50:37891`.

## Tailscale

Use the host's Tailscale IP or MagicDNS name. This is usually the easiest safe remote path.

## WireGuard

Use the WireGuard interface address. Confirm firewall rules only allow trusted peers.

## SSH tunnel

Forward the Pi Remote port through SSH and pair with the local forwarded address.

Example from a workstation:

```bash
ssh -L 37891:127.0.0.1:37891 user@host
```

## USB / ADB reverse

For a phone connected by USB debugging:

```bash
adb reverse tcp:37891 tcp:37891
```

Then pair Android with `127.0.0.1:37891`.

## Do not expose publicly

Do not router-port-forward or publish the WebSocket port directly to the internet. The protocol is cleartext `ws://` and is intended to be protected by LAN/VPN/tunnel transport.
