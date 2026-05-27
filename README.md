# pi-ez-lib

Shared utility library for pi-ez packages and pi-chat extensions.

Current exports include a remote slash-command matcher for extension `input` hooks. It recognizes the shapes pi-chat/Discord workers currently pass through:

- `/chat-git status`
- `<@bot> /chat-git status`
- `/chat-git status <@bot>`
- `- [time] [uid:...] user: <@bot> /chat-git status`

This package is a library only; it does not register any pi extensions or slash commands by itself.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```
