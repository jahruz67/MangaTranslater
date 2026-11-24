# Manga Translator BYOK

### Your manga. Your language. Your choice of AI.

Translate manga images right where you read them. Hover over a panel, translate a page, and keep reading with translated text layered over the original artwork.

**BYOK means “bring your own key.”** Connect your own AI provider, choose your languages, and control how your translations read.

[Get started](#get-started) · [Reading controls](#reading-controls) · [Your data & API usage](#your-data--api-usage)

---

## Make it yours

- **One panel or a whole page.** Translate a single image or work through the images already loaded on a page.
- **Choose your translation style.** Use natural or literal wording, and add preferences for tone, names, or terminology.
- **Fine-tune the result.** Adjust translated text and its placement, choose a font, and include sound effects if you like.
- **Keep a copy.** Save a translated image as a PNG.
- **Return to the artwork.** Remove a translation whenever you want. Original page images stay unchanged.

Works with **Chrome and Edge** (Chromium 114 or newer). Supports **OpenAI-compatible providers, Gemini, and Anthropic** with an image-capable model.

## Get started

You’ll need an API key and the exact name of an image-capable model from your chosen provider. API usage may cost money.

### 1. Add the extension

1. Open your browser’s **Extensions** management page.
2. Turn on **Developer mode**, then select **Load unpacked**.
3. Choose this **`byok` folder**—the one containing `manifest.json`.

If you have the original extension in a parent folder, select `byok` itself.

There’s nothing to build and no dependencies to install.

### 2. Connect your provider

1. Open the extension and select **Settings**.
2. Choose your provider, paste your API key, and enter the exact **Vision model ID**. For an OpenAI-compatible provider, also check the **API base URL**.
3. Choose your source and target languages. Use **Auto** for the source if you’d like the model to identify it.
4. Select **Save Settings** or **Save & Test API Connection**.

The connection test checks a small text request. Image support is checked when you translate your first image.

### 3. Start reading

Reload an open manga webpage, hover over an image, and click **Translate**. You can also use the image’s right-click menu or press **Alt + Shift + Z** while hovering.

For a full page, scroll first so its images load, then open the extension and choose **Translate page**. Images are processed in page order.

## Reading controls

| Want to… | Use |
| --- | --- |
| Translate one image | Hover → **Translate**, the right-click menu, or **Alt + Shift + Z** |
| Translate loaded images on the page | **Translate page** in the extension popup |
| Cancel the current request and remaining images | **Stop translation** in the popup, or **Stop** beside Settings on the page |
| Adjust translated text or its placement | **Edit** on a translated image |
| Download a translated image | **Save PNG** on a translated image |
| View one image without its translation | **Original** on that image |
| Remove all translations and discard pending rendering | **Restore originals** in the popup |

Settings changes apply to future requests. Finish or stop a page translation before changing them.

## Your data & API usage

Image portions and language preferences go directly to your selected AI provider. Translation uses your provider’s API; it doesn’t require a Tori account or service.

Your key is saved locally in the extension, without browser sync. It is **not encrypted at rest**, and only trusted extension contexts can read it. Use **Delete API Key** in Settings to remove the saved key.

Stopping a translation cancels the extension’s request, but your provider may still process or charge for work it already received. Deleting a key cannot recall a request already sent.

## A few things to know

- Translations and text placement depend on the selected model. You can correct results with **Edit**.
- Text cleanup covers areas with estimated background colors. Detailed artwork and speech bubble edges may need manual adjustment.
- Page translation works on loaded images on ordinary image or canvas webpages. Some sites prevent images from being read.
- Translations disappear when you reload the page. Use **Save PNG** to keep a copy; exports use the image resolution used for text recognition.
- Model support and performance have not been verified with a live API key, and browser behavior has not been verified in a live browser.

<details>
<summary><strong>Advanced provider & timeout settings</strong></summary>

Model IDs are entered manually so you can choose a vision model available from your provider. OpenAI-compatible endpoints must support Chat Completions with `image_url` inputs and return text in `message.content`. Use HTTPS; HTTP is supported only for localhost endpoints.

**Request timeout** defaults to Automatic: 90 seconds for most models, or four minutes per image tile for model IDs containing `gemma-4-31b-it`. That model uses streamed responses on Gemini and compatible providers, with text-recognition tiles capped at 1000 pixels. Smaller tile settings are respected.

You can change the timeout in Settings. Your provider may enforce a shorter limit, and **Stop** remains available while waiting.

</details>

<details>
<summary><strong>For contributors</strong></summary>

No build step or dependency installation is required. To run the existing checks from this folder:

```sh
node --test tests/*.test.js
```

The tests use mocks rather than a browser or paid API. For architecture, request flow, and implementation details, see the [technical report](TECHNICAL_REPORT.txt).

</details>
