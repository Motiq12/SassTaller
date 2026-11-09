// Configuración de Railway como código (Infrastructure as Code).
//
// Generado con `railway config migrate --service SassTaller --variables unmanaged`
// a partir de railway.json, que Railway deja de leer el 2026-12-01.
//
// TODAVÍA NO ESTÁ ACTIVO: Railway sigue leyendo railway.json hasta que se haga el
// "cutover" (pasos en la descripción del PR). Railway no lee .railway/ al desplegar.
//
// Variables: `managed: false` a propósito. Los secretos (DATABASE_URL, JWT_SECRET,
// RESEND_API_KEY…) siguen viviendo en el panel de Railway y nunca en el repositorio.
//
// Lo que este formato no expresa: la política de reinicio de railway.json
// (ON_FAILURE, 3 reintentos). Queda configurada en el panel del servicio.
import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "SassTaller";
export default defineRailway(() => {
  const SassTaller = service("SassTaller", {
    source: github("Motiq12/SassTaller", { branch: "main", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "NIXPACKS" },
    start: "node backend/src/cluster.js",
    healthcheck: "/api/health",
    healthcheckTimeout: 30,
    replicas: { "sfo": 1 },
    domains: ["motiq12.com", "www.motiq12.com"],
    networking: { privateNetworkEndpoint: "sasstaller" },
  });

  return project("Motiq12", {
    variables: { managed: false },
    resources: [SassTaller],
  });
});

