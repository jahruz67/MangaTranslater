MANGA TRANSLATOR BYOK

INSTALLATION (Chrome / Edge, Chromium 114 or newer)
1. Open your browser's extension management page manually.
2. Enable Developer mode, choose Load unpacked, and select THIS byok directory.
   Do not select its parent: the parent contains the preserved original extension.
3. Open the extension popup, then Settings.
4. Select a provider, enter your API key and exact vision-capable model ID,
   and choose source/target languages. Save or Save & Test API Connection.
5. Reload an existing manga webpage. Hover over a loaded image and click
   Translate, use its right-click menu, or press Alt+Shift+Z.
6. Translate Page processes currently loaded images in document order.
   Scroll to load lazy images before starting. Stop aborts the active request
   and cancels remaining images. It is also beside Settings in the page overlay.

No build, dependency installation, remote script, or Tori service is needed.
For gemma-4-31b-it on Gemini, Automatic timeout allows four minutes per tile,
uses streamed responses, and caps OCR tiles at 1000 pixels. A smaller OCR tile
setting is still respected. Other models retain the 90-second default. You can
change Request timeout in Settings; Stop still cancels immediately.
Provider/server limits may end a request sooner. Model support and performance
have not been verified with a live API key.
The API connection test makes a small text request; image support is checked
during translation. API provider usage may incur charges.

CONTROLS
Original removes one translated overlay. Restore Originals removes all overlays
and discards pending rendering. Edit adjusts text and pixel coordinates. Save
PNG exports a composed image at the OCR working resolution. Settings changes
apply to subsequent requests; avoid changing them midway through a page job.

Providers: OpenAI-compatible Chat Completions (custom base URL), Gemini, Anthropic.
Select a model from your provider's available vision models. Model IDs are not
hardcoded. Compatible endpoints must implement image_url inputs and return
message.content text. HTTP is supported only for localhost endpoints.

Keys are saved in chrome.storage.local, without sync or encryption at rest.
Only trusted extension contexts can read that storage. Delete API Key removes
the saved key; an already dispatched API request cannot be recalled.

Known limitations: vision-estimated boxes, rectangular cleanup, loaded images
only, ordinary image/canvas webpages only. See TECHNICAL_REPORT.txt for details.

DEVELOPER CHECKS
From this directory: node --test tests/*.test.js
No npm install or build step is required. Tests use mocks, not a browser or
paid API. Real API and browser behavior have not been verified.
