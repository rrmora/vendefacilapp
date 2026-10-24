This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## IA y despliegue en Vercel

Las llamadas reales a proveedores de IA están deshabilitadas por defecto. El modo mock se conserva con `AI_ENABLED=false`.

### Entornos

| Entorno | `AI_ENABLED` | `AI_REAL_CALLS_ENABLED` | Resultado |
|---|---|---|---|
| Production | `true` | `true` | Permite el flujo real si hay proveedor, cuota y presupuesto disponibles. |
| Preview | `false` o ausente | `false` o ausente | Modo mock. |
| Development | `false` o ausente | `false` o ausente | Modo mock. |

`AI_REAL_CALLS_ENABLED` debe configurarse únicamente en el scope **Production** de Vercel. No debe llevar el prefijo `NEXT_PUBLIC_`.

### Secretos y proveedores

- Configura `AI_GEMINI_API_KEY`, `AI_GROQ_API_KEY` y `AI_OPENAI_API_KEY` como variables de servidor en Vercel, nunca en el repositorio.
- OpenAI requiere además `AI_OPENAI_ENABLED=true`.
- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` son necesarias para cuota, rate limit y presupuesto.
- Los cambios de variables de entorno requieren un nuevo deployment para aplicarse.

### Límites de la autorización

Habilitar `AI_ENABLED=true` y `AI_REAL_CALLS_ENABLED=true` no garantiza que exista un proveedor elegible, presupuesto disponible ni una configuración de red válida. Si falta un proveedor con API key, el endpoint responde 503 antes de reservar cuota o presupuesto. En Vercel también debe revisarse la configuración de IP/proxy (`TRUST_PROXY`) antes de habilitar llamadas reales.

Las pruebas no realizan llamadas reales: usan un `fetch` mockeado y credenciales ficticias.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
