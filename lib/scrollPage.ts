// Explicit user action only; bounded and restored even if the page stops growing.
export async function scrollPage() {
  const x = scrollX, y = scrollY;
  try {
    for (let step = 0; step < 10; step++) {
      window.scrollTo({ top: Math.min(scrollY + Math.max(innerHeight * 0.8, 400), document.documentElement.scrollHeight), behavior: 'instant' });
      await new Promise(resolve => setTimeout(resolve, 250));
      if (scrollY + innerHeight >= document.documentElement.scrollHeight) break;
    }
  } finally { window.scrollTo({ left: x, top: y, behavior: 'instant' }); }
}
