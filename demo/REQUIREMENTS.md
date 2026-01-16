# Demo Monorepo Requirements

## Current Features

### API Service
- [x] User CRUD operations
- [x] Health check endpoint
- [x] Input validation with Zod
- [x] Email validation

### Web Application
- [x] User list display
- [x] API integration
- [x] Basic styling

### Shared Package
- [x] Date formatting
- [x] Email validation
- [x] Retry utility

## Planned Features

### API Service
- [ ] Authentication middleware
- [ ] Rate limiting
- [ ] Request logging
- [ ] Database persistence (PostgreSQL)

### Web Application
- [ ] User creation form
- [ ] User deletion
- [ ] Loading states
- [ ] Error handling

### Shared Package
- [ ] Currency formatting
- [ ] Phone number validation
- [ ] Pagination helpers

## Technical Debt

- Add comprehensive test coverage
- Add API documentation (OpenAPI/Swagger)
- Add CI/CD pipeline
- Add Docker support

## Notes for Agents

When implementing features:
1. Check if shared utilities exist before creating new ones
2. Keep API responses consistent
3. Update this file when completing features
