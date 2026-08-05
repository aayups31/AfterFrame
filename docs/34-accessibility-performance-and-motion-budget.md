# 34 — Accessibility, Performance, and Motion Budget

## Principle

Premium means the experience feels immediate, readable, calm, and controllable. A slow or inaccessible cinematic interface is not premium.

## Accessibility baseline

Target WCAG 2.2 AA for production.

Required from the first vertical slice:

- semantic heading and landmark structure;
- complete keyboard navigation;
- visible focus states consistent with the visual language;
- screen-reader labels for evidence hints, branches, notes, and source locators;
- no meaning communicated only by animation, position, or color;
- captions/transcripts for product audio;
- playlist controls that do not trap keyboard focus;
- text resizing to 200% without content loss;
- high-contrast source and uncertainty states;
- clear spoiler announcements;
- no forced autoplay audio.

## Reduced motion

With `prefers-reduced-motion`:

- replace scroll-linked transforms with opacity or immediate state changes;
- remove parallax and scale drift;
- disable smooth-scroll hijacking;
- preserve narrative order and focus placement;
- keep essential connection cues visible statically;
- never block content behind animation completion.

## Motion budget

- one dominant motion event per viewport;
- no character-by-character text animation for reading passages;
- entry transitions normally 250–700 ms;
- major chapter transitions may reach 1200 ms only when user-controlled;
- no perpetual decorative motion in the reading surface;
- scroll effects must be reversible and deterministic;
- animation cannot delay source inspection or note capture.

## Performance budgets

Initial production targets on a representative mid-range laptop and phone:

- LCP under 2.5 seconds for the investigation shell;
- INP under 200 ms;
- CLS under 0.1;
- first mocked beat visible under 1 second after case shell load;
- first live meaningful beat target under 10 seconds, with honest progress state;
- route JavaScript under 250 KB compressed before optional visualization modules;
- home hero media loaded responsively with poster and reduced-data fallback;
- 60 fps during primary scroll interactions where device capacity allows;
- no more than two simultaneous blur/filter animations.

## Long-case rendering

- virtualize only sections far outside the reading window;
- preserve anchor stability when beats stream in;
- avoid reflow by reserving known media ratios;
- store measured beat heights if needed;
- never unload the currently referenced evidence or note anchor;
- progressively load graph/world views separately from the reading stream.

## Testing matrix

- keyboard only;
- screen reader on macOS and Windows;
- reduced motion;
- 200% zoom;
- low-power mobile;
- slow 4G;
- long case with 200+ beats;
- missing image and failed font;
- autoplay denied;
- JavaScript hydration delay.
