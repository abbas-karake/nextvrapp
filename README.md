# Next VR App

A small first-person WebXR terrain playground built for iterative testing on Meta Quest.

## Current milestone

- Procedural low-cost terrain and landmarks
- Enter/exit immersive VR through the browser
- Left thumbstick: move relative to view direction
- Right thumbstick: smooth turn
- A/X or either thumbstick press: jump
- Physical headset movement/look remains active
- Desktop fallback: click for mouse look, WASD to move, Space to jump

## Run locally

```bash
npm install
npm run dev
```

## Verify

```bash
npm test
npm run build
npm run preview
```

## Quest testing

Open the deployed HTTPS GitHub Pages URL in Meta Quest Browser, press **ENTER VR**, then grant the immersive-session request. Physical Quest testing is required to validate controller mapping, floor height, comfort, and frame pacing.

## Technology

TypeScript, Vite, Three.js, WebXR. The terrain and landmarks are generated in code; no third-party art assets are included.
