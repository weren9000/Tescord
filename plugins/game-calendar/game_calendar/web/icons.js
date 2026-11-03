// Generated from the shared cosmic glyphs by export-plugin-controls.cjs.
const glyphs = {
  "vacation": {
    "body": "M16 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8M2 13q6-6 12 0z",
    "line": "M8 13v8M3 22h13M16 13v3M21 11l2 2"
  },
  "trash": {
    "body": "M4 8h16l-1 14H5zM8 11v8h2v-8zM14 11v8h2v-8zM2 4h20v2H2zM8 1h8v2H8z",
    "line": ""
  },
  "plus": {
    "body": "M10 2h4v8h8v4h-8v8h-4v-8H2v-4h8z",
    "line": ""
  },
  "check": {
    "body": "",
    "line": "M4 12l5 5L20 5"
  },
  "calendar": {
    "body": "M4 4h16q2 0 2 2v3H2V6q0-2 2-2M2 11h20v9q0 2-2 2H4q-2 0-2-2zM6 14v3h3v-3zM11 14v3h3v-3z",
    "line": "M7 2v4M17 2v4"
  },
  "filter": {
    "body": "M2 3h20L15 12v7l-6 3V12z",
    "line": ""
  },
  "search": {
    "body": "",
    "line": "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16M16 16l6 6"
  },
  "menu": {
    "body": "M2 4h20v3H2zM2 11h20v3H2zM2 18h20v3H2z",
    "line": ""
  },
  "back": {
    "body": "",
    "line": "M15 3l-9 9 9 9"
  },
  "forward": {
    "body": "",
    "line": "M9 3l9 9-9 9"
  },
  "close": {
    "body": "",
    "line": "M6 6l12 12M18 6L6 18"
  },
  "info": {
    "body": "M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22M11 5v3h2V5zM10 10v2h1v6h3v-2h-1v-6z",
    "line": ""
  },
  "groups": {
    "body": "M8 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8M18 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6M1 19q0-7 7-7t7 7v2H1zM17 12q6 0 6 7v2h-6q2-5-1-9z",
    "line": ""
  },
  "expand": {
    "body": "",
    "line": "M14 3h7v7M21 3l-7 7M10 21H3v-7M3 21l7-7"
  },
  "star": {
    "body": "M12 1l3.3 6.8 7.5 1.1-5.4 5.3 1.3 7.5-6.7-3.5-6.7 3.5 1.3-7.5-5.4-5.3 7.5-1.1z",
    "line": ""
  },
  "location": {
    "body": "M12 1a9 9 0 0 0-9 9q0 6 9 13 9-7 9-13a9 9 0 0 0-9-9M12 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8",
    "line": ""
  }
};
export function icon(name) {
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','ui-icon');
 const glyph=glyphs[name]||glyphs.info;
 for(const [kind,d] of Object.entries(glyph)) { const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',d);p.setAttribute('fill',kind==='body'?'currentColor':'none');p.setAttribute('fill-rule','evenodd');if(kind==='line'){p.setAttribute('stroke','currentColor');p.setAttribute('stroke-width','2.3');p.setAttribute('stroke-linecap','round');p.setAttribute('stroke-linejoin','round');}svg.append(p); }
 return svg;
}
