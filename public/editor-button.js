// The block added to Homepage's custom.js: a small "Edit" button, top right, that opens this editor in
// its own window. Kept between marker lines so the editor can find, check and restore it.
export const BUTTON_BEGIN = '// >>> Homepage Editor button (added by Homepage Editor, port 7200; keep this block) >>>';
export const BUTTON_END = '// <<< Homepage Editor button <<<';

export const BUTTON_JS = `${BUTTON_BEGIN}
(() => {
  if (document.getElementById("hp-editor-button")) return;
  const url = \`\${location.protocol}//\${location.hostname}:7200/\`;
  const a = document.createElement("a");
  a.id = "hp-editor-button";
  a.href = url;
  a.title = "Edit this dashboard (Homepage Editor)";
  a.textContent = "\\u270E Edit";
  // Its own window; clicking again brings the same window back to the front.
  a.addEventListener("click", (e) => {
    e.preventDefault();
    window.open(url, "homepage-editor", "width=1500,height=950")?.focus();
  });
  Object.assign(a.style, {
    position: "fixed", top: "10px", right: "12px", zIndex: "50", padding: "4px 10px", borderRadius: "8px",
    font: "600 12px Manrope, system-ui, sans-serif", textDecoration: "none", opacity: "0.7",
    color: "rgb(var(--color-200, 226 232 240))", background: "rgb(var(--color-900, 15 23 42) / 0.55)",
    border: "1px solid rgb(var(--color-500, 100 116 139) / 0.5)", backdropFilter: "blur(4px)",
  });
  a.addEventListener("mouseenter", () => (a.style.opacity = "1"));
  a.addEventListener("mouseleave", () => (a.style.opacity = "0.7"));
  document.body.append(a);
})();
${BUTTON_END}
`;

export const hasButton = text => (text ?? '').includes(BUTTON_BEGIN) && (text ?? '').includes(BUTTON_END);
