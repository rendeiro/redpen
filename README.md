# Redpen

A small Chrome extension for preparing screenshots. Select words on any page and either mark them in red, like a marker pen, or black them out.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.

## Use

Select some text, then:

| Action | Shortcut |
|---|---|
| Underline in red | `Alt+Shift+U` |
| Circle in red | `Alt+Shift+C` |
| Black out | `Alt+Shift+B` |
| Undo the latest mark | `Alt+Shift+Z` |

The same actions, plus **Clear all marks**, are in the right-click menu and behind the toolbar icon. Shortcuts can be changed at `chrome://extensions/shortcuts`.

- Add as many marks as you like, of any mix. Select, mark, select the next bit, mark again.
- `Alt`+click a mark to remove it.
- `Alt+Shift`+click a mark to change its type: underline, circle, blackout.
- Marks follow the text when you scroll or resize. They are gone after a reload.

Then take the screenshot the usual way (`Cmd+Shift+4` on a Mac).

## What a blackout does and does not do

A blackout paints a solid black bar over the text. In a screenshot the words are gone for good; there is nothing under the black pixels to recover.

The text itself is still in the page. So a blackout protects a screenshot, not a saved copy of the page, a printed PDF, or a live screen share where someone else controls the page. The bar is as wide as the words it hides, so it still hints at their length.

## Limits

- Works on selectable text. Not on images, canvas apps such as Google Docs, or text typed into input boxes.
- Text inside a frame from another site may be out of reach.
- If a site rebuilds the text you marked, the mark is dropped. Mark it again.
- Chrome blocks all extensions on `chrome://` pages, the Web Store and its PDF viewer.
- Marks slide under a pinned header only when the header has a plain solid background. Otherwise they stay on top, so a blackout never vanishes while its text is still readable.

## Privacy

No access to any site until you use a shortcut, the menu or the icon on that tab. Nothing is stored and nothing is sent anywhere.

## Development

No build step. `draw.js` holds the geometry and the hand-drawn paths, `content.js` runs in the page, `background.js` connects the shortcuts and menus to it.

```bash
node --test
```

To try the page script without installing the extension, serve this folder (`python3 -m http.server 8797`) and open `http://localhost:8797/test/fixture.html?harness`. Without `?harness` the same page is a test bed for the installed extension. Icons come from `python3 make_icons.py`.

## License

MIT
