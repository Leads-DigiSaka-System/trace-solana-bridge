import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "Trace Solana Bridge API",
            version: "1.0.0",
            description:
                "API for interacting with Solana programs for supply chain tracing.",
            contact: {
                name: "API Support",
            },
        },
        servers: [
            {
                url: "/api/v1",
                description: "V1 API",
            },
        ],
        components: {
            securitySchemes: {
                hmacAuth: {
                    type: "apiKey",
                    in: "header",
                    name: "x-hmac-signature",
                    description: "HMAC signature for request authentication.",
                },
                timestamp: {
                    type: "apiKey",
                    in: "header",
                    name: "x-timestamp",
                    description: "Timestamp used for HMAC generation.",
                },
                nonce: {
                    type: "apiKey",
                    in: "header",
                    name: "x-hmac-nonce",
                    description: "Unique 16-128 character request nonce.",
                },
            },
        },
        security: [
            {
                hmacAuth: [],
                timestamp: [],
                nonce: [],
            },
        ],
    },
    apis: ["./src/controllers/*.ts", "./src/routes/*.ts"], // Path to the API docs
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
