import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'ILIAGPT PRO API',
      version: '1.0.0',
      description: 'API documentation for ILIAGPT PRO 3.0',
      contact: {
        name: 'API Support',
        email: 'support@iliagpt.com',
      },
    },
    servers: [
      {
        url: '/api',
        description: 'Main API Server',
      },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'connect.sid',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message',
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['user', 'admin'] },
          },
        },
      },
    },
    security: [
      {
        cookieAuth: [],
      },
    ],
  },
  apis: [], // No JSDoc scanning needed — all definitions are inline above
};

function buildSwaggerSpec() {
  // En prod/CI/tests no queremos que swagger-jsdoc tumbe el server.
  // (En prod normalmente ni siquiera se usa swagger UI.)
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.CI === 'true' ||
    process.env.NODE_ENV === 'test'
  ) {
    return options.swaggerDefinition as any;
  }

  try {
    return swaggerJsdoc(options);
  } catch (err) {
    console.warn(
      '[Swagger] swagger-jsdoc generation failed; using static definition',
      err
    );
    return options.swaggerDefinition as any;
  }
}

export const swaggerSpec = buildSwaggerSpec();
