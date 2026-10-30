// Shared geometry from frontend/src/app/workspace/ui-icon.component.ts.
const paths = {
  calendar:
    "M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2M7 2v5M17 2v5M3 10h18M7 14h2M12 14h2M7 17h2",
  filter: "M3 4h18l-7 8v7l-4 2v-9z",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13M16 16l5 5",
  menu: "M4 6h16M4 12h16M4 18h16",
  back: "M15 18l-6-6 6-6",
  forward: "M9 6l6 6-6 6",
  close: "M6 6l12 12M18 6L6 18",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 7h.01",
  groups:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  expand: "M14 4h6v6M20 4l-8 8M10 20H4v-6M4 20l8-8",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
  location:
    "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0M15 10a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
};
export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.7",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    class: "ui-icon",
  }))
    svg.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[name] || paths.info);
  svg.append(path);
  return svg;
}
