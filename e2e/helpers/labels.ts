import type { Page } from "@playwright/test";

const OVERLAY_ID = "skuffen-demo-label";

/** On-screen step label, sized for 1280×720 recordings. */
export async function showDemoLabel(page: Page, text: string): Promise<void> {
  await page.evaluate(
    ({ id, text: label }) => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.setAttribute("data-demo-label", "1");
        el.setAttribute("role", "status");
        Object.assign(el.style, {
          position: "fixed",
          left: "28px",
          bottom: "28px",
          zIndex: "2147483646",
          maxWidth: "min(920px, calc(100vw - 56px))",
          padding: "14px 22px",
          borderRadius: "12px",
          border: "2px solid #c6a15b",
          background: "rgba(12, 10, 9, 0.92)",
          color: "#fff8ea",
          fontFamily: '"Iowan Old Style", Palatino, "Times New Roman", serif',
          fontSize: "28px",
          fontWeight: "600",
          lineHeight: "1.25",
          letterSpacing: "0.01em",
          boxShadow: "0 8px 28px rgba(0,0,0,0.45), 0 0 0 1px #2a1c12",
          pointerEvents: "none",
        } as Partial<CSSStyleDeclaration>);
        document.body.appendChild(el);
      }
      el.textContent = label;
    },
    { id: OVERLAY_ID, text },
  );
  await hold(page, process.env.DEMO_RECORD ? 1800 : 0);
}

export async function hold(page: Page, ms = 1200): Promise<void> {
  const wait = process.env.DEMO_RECORD ? ms : 0;
  if (wait > 0) {
    await page.waitForTimeout(wait);
  }
}
