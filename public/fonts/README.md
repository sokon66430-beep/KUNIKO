# Khmer typeface — Niradei

Drop the font files here and every Khmer surface in the app switches to them:
price labels, promotion stickers, the customer second screen and the queue TVs.

Expected filenames (declared in `src/app/globals.css`):

    niradei-regular.woff2   (or .ttf)
    niradei-bold.woff2      (or .ttf)

`.woff2` is strongly preferred — it is roughly 40% of the size of a `.ttf`,
which matters on a Sunmi till over shop wifi. If you only have `.ttf`, it still
works; the CSS lists both.

Until these files exist the stack falls through to Kantumruy Pro, so nothing
breaks — Khmer simply renders in the previous typeface.

One thing to check before shipping: desktop font licences often do NOT cover
web embedding, which is what this does. Confirm the Niradei licence allows it.
