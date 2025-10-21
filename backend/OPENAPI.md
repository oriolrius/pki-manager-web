# OpenAPI / Swagger Documentation

This project uses **trpc-swagger** to generate OpenAPI 3.0.3 specifications from tRPC procedures.

## Access Points

Once the server is running, you can access:

### Swagger UI (Interactive Documentation)
```
http://localhost:3000/api/docs
```
- Interactive API explorer
- Try out API endpoints directly from the browser
- View request/response schemas

### OpenAPI Specification (JSON)
```
http://localhost:3000/api/openapi.json
```
- OpenAPI 3.0.3 compliant JSON specification
- Can be imported into Postman, Insomnia, or other API tools
- Use for API client generation

## How It Works

1. **tRPC Procedures** are annotated with OpenAPI metadata using `.meta()`:
   ```typescript
   list: publicProcedure
     .meta({
       openapi: {
         method: 'GET',
         path: '/certificates',
         tags: ['certificates'],
         summary: 'List certificates',
         description: 'Retrieve a paginated list...',
       },
     })
     .input(listCertificatesSchema)
     .query(async ({ ctx, input }) => { ... })
   ```

2. **Input/Output Schemas** are defined using Zod, which automatically generates OpenAPI schemas

3. **OpenAPI Document** is generated in `src/trpc/openapi.ts` using `generateOpenApiDocument()`

4. **Swagger UI** is served at `/api/docs` with interactive documentation

## Adding OpenAPI to New Procedures

To add OpenAPI documentation to a new tRPC procedure:

1. Add `.meta()` with OpenAPI metadata:
   ```typescript
   .meta({
     openapi: {
       method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
       path: '/your-endpoint',
       tags: ['category'],
       summary: 'Short description',
       description: 'Detailed description',
     },
   })
   ```

2. Ensure your procedure has `.input()` with a Zod schema (required for OpenAPI)

3. The output schema is automatically inferred from your query/mutation return value

## Current Endpoints with OpenAPI

- `GET /certificates` - List certificates with filtering, searching, sorting, and pagination

## Future Enhancements

As more endpoints are implemented, add OpenAPI metadata to:
- Certificate operations (get, create, renew, revoke, delete)
- CA operations (list, create, get, revoke)
- CRL operations (generate, list, get)
- Audit log queries

## Benefits

✅ **Auto-generated** - No manual OpenAPI spec maintenance
✅ **Type-safe** - Uses the same Zod schemas as tRPC
✅ **Interactive** - Swagger UI for testing
✅ **Standards-compliant** - OpenAPI 3.0.3
✅ **Dual Access** - Use tRPC client OR OpenAPI/REST clients
