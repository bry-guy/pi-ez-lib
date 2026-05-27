# pi-ez-chat-remote-command

Shared matcher for pi-ez pi-chat extension input hooks.

It recognizes remote slash commands in the shapes pi-chat/Discord workers currently pass to extension `input` hooks:

- `/chat-git status`
- `<@bot> /chat-git status`
- `/chat-git status <@bot>`
- `- [time] [uid:...] user: <@bot> /chat-git status`

## Development

```bash
npm install
npm test
npm run typecheck
```
