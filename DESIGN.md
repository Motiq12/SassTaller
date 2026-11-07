# Design System: MS Motos — el estilo del sitio web

> Fuente única de verdad para generar pantallas en **Google Stitch** que calcen con
> la app real (Ionic/Angular). Pegá este archivo como contexto y pedí una pantalla a
> la vez. Atmósfera: **Density 7 (cockpit operativo), Variance 4 (estructura clara con
> acentos), Motion 5 (físico y sobrio)**. Todos los textos de interfaz en **español
> (Costa Rica)**, moneda en colones con símbolo **₡**.
>
> **El sistema usa el mismo estilo que el sitio web** (`msmotors-web`): quien pasa del
> sitio al portal de clientes, o del portal al panel, tiene que sentir que sigue en el
> mismo lugar. Los colores, las tipografías y las esquinas salen del sitio
> (`tailwind.config.js` y `css/style.css`); aquí viven en `frontend/src/theme/variables.scss`.
> Si el sitio cambia su estilo, este documento y esas variables cambian con él.

## 1. Visual Theme & Atmosphere
Herramienta operativa para un taller y una agencia de motocicletas — densa pero
respirable. Superficies frías casi negras, un único acento, el rojo de marca, que
aparece con disciplina (estados activos, totales, acciones primarias), títulos y
etiquetas en una tipografía técnica y angulosa, datos siempre en monoespaciada para
lectura rápida. Sensación: **técnica, confiable, de taller**. La marca vive en el
contraste, el rojo y la tipografía, no en gradientes ni brillos.

## 2. Color Palette & Roles
Los nombres entre paréntesis son los del sitio (`tailwind.config.js`).
- **Tinta** (#0B0D10, `ink`) — Fondo principal en modo oscuro; texto primario en modo claro
- **Panel** (#14171C, `panel`) — Tarjetas y contenedores en modo oscuro
- **Panel 2** (#1B1F26, `panel2`) — Superficie elevada dentro de una tarjeta
- **Borde** (rgba(255,255,255,0.08)) — Líneas hairline de 1px sobre fondo oscuro
- **Texto secundario** (#94A3B8, slate-400) — metadatos y etiquetas; **Texto tenue** (#8591A3)
- **Rojo de marca** (#E2231A, `accent`) — **único acento**: CTA primario, estado activo, totales, FAB, foco. Con texto blanco encima da 4,68:1
  - Presionado/hover: **Rojo oscuro** (#C2201A, `accent2`). El hover oscurece, no aclara: un rojo más claro no llega a 4,5:1 con texto blanco
  - Para **texto** sobre fondo oscuro: **Rojo claro** (#F24A3D, `accentText`). Son dos tokens porque un solo rojo no cumple las dos cosas
  - Tinte de fondo en modo claro: #FEF2F1 con borde #FBCDC8
- **Esmeralda** (#059669 / fondo #ECFDF5) — éxito, "a tiempo", "OK"
- **Ámbar** (#D97706 / fondo #FEF3C7) — advertencia, "por vencer", pendiente
- **Rojo Alerta** (#DC2626) — peligro, "requiere aprobación", atrasada
- **Índigo** (#4F46E5 / fondo #EEF2FF) — presupuesto/aprobación, rol técnico
- **Modo claro** (la app del personal y el portal siguen el tema del teléfono o la computadora; el sitio y el panel son siempre oscuros): lienzo #F8FAFC, tarjetas #FFFFFF, texto #0B0D10, bordes rgba(11,13,16,0.07). La escala de grises es la fría (slate), no la neutra.

Restricciones: **un solo acento**, sin púrpura/azul neón, sin glows, sin gradientes en
botones, sin mezclar grises cálidos y fríos (toda la escala es slate).

## 3. Typography Rules
- **Display** (`Rajdhani`, 600–700) — títulos, números grandes, botones y etiquetas. Sin interletraje negativo: es angosta y se aprieta. Las etiquetas y los botones van en MAYÚSCULAS con tracking 0.04–0.12em, como en el sitio.
- **Cuerpo** (`Inter`, 400–700) — texto, formularios, ~65ch máx, color secundario para metadatos.
- **Mono** (`JetBrains Mono`) — **obligatorio** para montos ₡, fechas, placas, IDs de orden (densidad > 7). Cifras tabulares. El sitio no la usa: es propia del sistema, porque aquí hay tablas de datos.
- Rajdhani e Inter se sirven desde la app (`frontend/src/assets/fonts`), los mismos archivos del sitio. Rajdhani llega hasta 700: pedir 800 o 900 da 700.
- **Banned:** cualquier serif en UI de software; otra tipografía de títulos que no sea la del sitio.

## 4. Component Stylings
- **Esquinas:** rectas, como en el sitio. **2px** en botones, campos, etiquetas, pestañas y barras; **8px** en tarjetas, modales y hojas. Solo son redondos los puntos de estado, los avatares circulares y el FAB.
- **Botones:** Relleno sólido rojo de marca para primario; outline/fantasma para secundario. Sin glow. En Rajdhani 600, MAYÚSCULAS, tracking 0.04em. Feedback táctil `scale(0.97)` al presionar.
- **Tarjetas:** Esquinas 8px (`--radius-card`), borde hairline 1px + sombra difusa. Entran con un `cardRise` sutil. En layouts densos, reemplazar tarjeta por divisores border-top.
- **Inputs:** Etiqueta arriba (o flotante en formularios), radio 2px, anillo de foco rojo, error debajo. Nada de placeholders como única etiqueta.
- **Badges:** Etiqueta rectangular de 2px, 11px, peso 700. Estado por color semántico (rojo/esmeralda/ámbar/índigo/gris).
- **Segmentos/Tabs:** Contenedor recto neutro con indicador rojo; contadores en mini-badge.
- **Stat-cards (KPIs):** Número grande en `Rajdhani` rojo, etiqueta diminuta en mayúsculas, adorno en la esquina.
- **Timeline:** Línea vertical roja de 1.5px con nodos de anillo; completados rellenos, actual con halo.
- **FAB:** Círculo rojo con sombra tintada; rota 90° en hover.
- **Loaders:** Skeleton shimmer con la forma exacta del contenido. **Nunca** spinner circular genérico.
- **Empty states:** Composición con ícono de línea fina + texto + acción sugerida.

## 5. Layout Principles
- Grilla CSS primero; sin hacks de `calc()` por porcentaje.
- Contenedores con max-width (dashboard ~1240px centrado; detalle/formularios ~760–860px).
- **Mobile-first:** todo colapsa a una columna < 768px; sin scroll horizontal jamás.
- En escritorio, las tarjetas fluyen en una **grilla responsiva** que se autoajusta por ancho (`grid` con `auto-fill`/`minmax`, p. ej. `repeat(auto-fill, minmax(360px, 1fr))`, o `1fr 1fr` en detalle), colapsando a una columna en móvil. **No se usa masonry real** (`grid-template-rows: masonry` es experimental y `columns` rompe el orden de lectura/tabulación): se prioriza la accesibilidad por teclado y el orden del DOM. <!-- Si en el futuro se quisiera el efecto visual masonry en alguna pantalla puntual de tarjetas muy desiguales, se evaluaría una solución JS que preserve el orden del DOM; no implementado. -->
- Toolbars **limpias de superficie** (no barras de color sólido); el acento es detalle, no fondo de barra. Header con hairline inferior.
- Tap targets mínimo 44px. Full-height con `min-h-[100dvh]`, nunca `h-screen`.

## 6. Motion & Interaction
- Easing físico real: `cubic-bezier(0.32, 0.72, 0, 1)` (sin linear).
- Presión táctil en tarjetas y botones (`scale` sutil); revelado en cascada de listas.
- Animar solo `transform` y `opacity`. Respetar `prefers-reduced-motion`.
- Micro-loops sobrios (shimmer en carga, pulso suave en "requiere aprobación").

## 7. Anti-Patterns (Banned)
- Sin serifs en UI, ni tipografías que no sean las del sitio.
- Sin negro puro (#000000) — usar la tinta #0B0D10.
- Sin glows/neón, sin acentos sobresaturados, sin gradientes en botones.
- Sin tres tarjetas iguales en fila como "feature row" — usar grilla asimétrica o scroll horizontal.
- Sin elementos superpuestos: cada uno en su zona espacial limpia.
- Sin textos de relleno ("Scroll", flechas que rebotan), sin cursores custom.
- Sin nombres genéricos ("John Doe", "Acme") ni números redondos falsos — usar datos ticos reales (Honda CB190R, placa MOT-123, ₡75.000, Juan Pérez).
- Sin imágenes rotas — usar avatares SVG o `picsum.photos`.

## Apéndice — Pantallas existentes (para mantener coherencia al generar nuevas)
**Entrar, crear cuenta y recuperar el acceso** (las usan clientes y personal; siempre oscuras):
en escritorio, dos columnas — la foto del taller con el logo, "Tu moto, en buenas manos" y lo
que hace el portal a la izquierda; el formulario directo sobre la tinta a la derecha. En tablet,
la foto es una franja arriba y el formulario se monta encima como una hoja. En el celular no va
la foto: solo el logo chico arriba del formulario. Campos
en caja con la etiqueta adentro y el foco en rojo; "Paso 1 de 2" en los formularios de dos pasos.
App del **personal**: Dashboard gerencial (stat-cards + semáforo en píldoras + KPIs +
facturación + tiempo por etapa), Lista de órdenes (cards con barra de estado lateral),
Detalle de OT (estado, costos mono, repuestos en pills, timeline, checklist, facturación,
evidencia, garantía, WhatsApp), Garantías, Promociones, Factura imprimible.
**Portal del cliente**: Mis órdenes (fidelidad en tarjeta negra con bloques + ofertas en
carrusel con degradado + órdenes con barra lateral), Detalle (presupuesto para aprobar
con borde índigo + seguimiento + encuesta de estrellas), Citas.
Estados de OT (con color de badge): recepción → diagnóstico → esperando aprobación →
esperando repuestos → en reparación → lista para entrega → entregada (o cancelada).
