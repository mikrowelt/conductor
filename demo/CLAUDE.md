# Demo Monorepo - Claude Code Instructions

This is a demo monorepo for testing Conductor. It contains three packages:
- `api` - Express.js API server
- `web` - React frontend application
- `shared` - Shared utilities

## Project Structure

```
demo/
├── api/          # Express API service
│   └── src/
│       ├── routes/
│       └── index.ts
├── web/          # React frontend
│   └── src/
│       ├── App.tsx
│       └── main.tsx
└── shared/       # Shared utilities
    └── src/
        └── index.ts
```

## Development Guidelines

### Code Style
- Use TypeScript strict mode
- Use ESM modules (`type: "module"`)
- Use functional components in React
- Prefer async/await over promises

### Testing
- Run tests with `pnpm test` in each package
- Use Vitest for unit tests

### Building
- Run `pnpm build` in each package
- Shared package must be built before api and web

## API Endpoints

- `GET /` - Root info
- `GET /health` - Health check
- `GET /api/users` - List all users
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create user
- `DELETE /api/users/:id` - Delete user

## Common Tasks

### Adding a new API endpoint
1. Create route handler in `api/src/routes/`
2. Register route in `api/src/index.ts`
3. Add types to shared if needed

### Adding a shared utility
1. Add function to `shared/src/index.ts`
2. Export from index
3. Build shared package before using
