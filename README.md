# Next VR App — Open City

A first-person WebXR city playground built for Meta Quest with TypeScript, Vite, and Three.js.

## Current milestone

- 240 × 240 metre explorable city district
- 45 modular downtown, skyscraper, and suburban buildings
- Roads, sidewalks, intersections, lane markings, crosswalks, streetlights, trees, and a fountain plaza
- 12 moving vehicles following closed street routes
- 10 animated pedestrians following sidewalk routes
- Mesh-derived collision bounds for buildings and props, plus moving vehicle, pedestrian, room-scale headset, and world-boundary collision
- Shared detailed city, suburban, and vehicle color atlases with windows, trim, storefronts, and car details
- Detached rounded controller-tracked hands with articulated trigger, grip, and thumb reactions
- Dual-hand sticky tether projectiles with visible ropes and building anchors
- Fixed-step swing physics with reel-in, air steering, preserved release momentum, and high-speed collision substeps
- High power jump and speed-driven wind audio
- Procedural footsteps, jump/landing, tether shoot/attach/release, traffic, crowd, and city ambience
- Left thumbstick: smooth movement relative to the current headset view
- Right thumbstick: smooth turn
- A/X or either thumbstick press: high power jump
- Hold either rear grip/squeeze: fire and maintain that hand's tether
- Release the rear grip: detach while preserving swing momentum
- Physical headset movement and look remain active
- Desktop fallback: click for mouse look, WASD to move, Space to jump

## Run locally

```bash
npm install
npm run dev
```

## Verify

```bash
npm test
npm run typecheck
npm run build
npm run preview
```

## Quest testing

Open the deployed HTTPS GitHub Pages URL in Meta Quest Browser, press **ENTER VR**, and grant the immersive-session request. The app enables foveated rendering when the immersive session starts. Physical Quest testing remains the final authority for controller pose, hand alignment, comfort, and frame pacing.

## Performance approach

- Shared prefab templates and materials
- Instanced sidewalks, streetlights, and road markings
- Distance-limited vehicle and pedestrian rendering
- Pedestrian animation updates only while visible
- Kinematic route and collision simulation instead of a heavy physics runtime
- Capped render pixel ratio and WebXR foveation

## Asset licenses

Runtime city, vehicle, tree, and pedestrian assets are free CC0 packs from Kenney and Quaternius. Exact source links, license details, and selected content are documented in [`THIRD_PARTY_ASSETS.md`](THIRD_PARTY_ASSETS.md). Original Kenney license files are preserved under `public/assets/licenses/`.
