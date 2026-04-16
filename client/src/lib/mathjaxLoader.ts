const LOCAL_MATHJAX_SRC = "/vendor/mathjax/tex-chtml.js";
const CDN_MATHJAX_SRC = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js";

let mathJaxLoading: Promise<void> | null = null;

function injectMathJaxScript(src: string): Promise<void> {
  if (window.MathJax?.typesetPromise) return Promise.resolve();

  return new Promise((resolve, reject) => {
    // Configure MathJax before loading the script.
    (window as any).MathJax = {
      tex: {
        inlineMath: [["$", "$"]],
        displayMath: [["$$", "$$"]],
        processEscapes: true,
      },
      startup: {
        ready: () => {
          try {
            (window as any).MathJax.startup.defaultReady();
            resolve();
          } catch (err) {
            reject(err);
          }
        },
      },
    };

    const existing = document.getElementById("mathjax-script");
    if (existing) existing.remove();

    const script = document.createElement("script");
    script.id = "mathjax-script";
    script.src = src;
    script.async = true;
    script.onerror = () => reject(new Error(`Failed to load MathJax from ${src}`));
    document.head.appendChild(script);
  });
}

export async function loadMathJax(): Promise<void> {
  if (window.MathJax?.typesetPromise) return;
  if (mathJaxLoading) return mathJaxLoading;

  mathJaxLoading = injectMathJaxScript(LOCAL_MATHJAX_SRC)
    .catch((localErr) => {
      // Local asset might be missing in dev (or not yet synced). Fall back to CDN.
      // Keep the warning low-noise: this file is intentionally offline-first.
      console.warn("[MathJax] Local load failed, falling back to CDN:", localErr);

      // Allow retry if CDN also fails.
      const existing = document.getElementById("mathjax-script");
      if (existing) existing.remove();
      delete (window as any).MathJax;

      return injectMathJaxScript(CDN_MATHJAX_SRC);
    })
    .catch((err) => {
      mathJaxLoading = null;
      throw err;
    });

  return mathJaxLoading;
}
