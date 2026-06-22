# Pi Remote Control Extension

Dev-only WebSocket remote control for an existing interactive Pi session.

## Pi side

Reload or restart Pi, then run:

```text
/remote-control
```

Config:

```text
~/.pi/agent/remote-control.json
```

For Android over LAN, use:

```json
{
  "enabled": true,
  "host": "0.0.0.0",
  "port": 37891,
  "allowNoAuthFromLoopback": false,
  "token": "..."
}
```

## Test client

From this directory:

```bash
npm run client -- state
npm run client -- prompt "Say hello"
npm run client -- steer "Focus on tests"
npm run client -- follow-up "Then summarize"
npm run client -- abort
npm run client -- listen
```

If testing locally while config host is `0.0.0.0`, the client defaults to `127.0.0.1`.

Override connection details:

```bash
npm run client -- --host 192.168.1.50 --port 37891 --token YOUR_TOKEN state
```

Raw WebSocket URL:

```bash
npm run client -- --url "ws://192.168.1.50:37891?token=YOUR_TOKEN" listen
```

## Android protocol

Connect to:

```text
ws://HOST:37891?token=TOKEN
```

Send JSON commands:

```json
{ "type": "prompt", "text": "Review the current changes" }
{ "type": "steer", "text": "Focus on tests" }
{ "type": "follow_up", "text": "Then summarize" }
{ "type": "abort" }
{ "type": "get_state" }
{ "type": "ping" }
```

Receive JSON events including:

- `hello`
- `assistant_delta`
- `assistant_message`
- `tool_start`
- `tool_update`
- `tool_end`
- `agent_start`
- `agent_end`
- `queue_update`
- `response`
