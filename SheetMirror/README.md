# SheetMirror

Google Apps Script project that copies a large Google Sheet in chunks to a separate destination spreadsheet. Used to mirror `26년 전체문의` (the GCX master inquiry log) to a read-only dashboard sheet.

**Script ID:** `1-t6Z95OM0EWsiXHOsExu-hPHMNRTHZ0HD7bdVoHMmbEPwKksRNyolVch`

---

## Files

| File | Purpose |
|------|---------|
| `Code.js` | `mirrorSheet()` + `onOpen()` menu |
| `appsscript.json` | GAS manifest |

---

## Config (top of `Code.js`)

| Key | Value |
|-----|-------|
| `sourceId` | `1sjcCj_P4DRD8rywkmYJhbsrzwFfgiJQuF9nIKwCiKlc` |
| `sourceSheet` | `26년 전체문의` |
| `destId` | `1qxwUjuV3-_0HRS1Bsb3Fsua0n8N6r6GzNnqiv9wRU10` |
| `destSheet` | `Sheet1` |
| `chunkSize` | `1000` rows per read-write cycle |

---

## Usage

Open the destination spreadsheet → **🔄 Mirror → Mirror now**, or run `mirrorSheet()` directly in the GAS editor.

The destination sheet is cleared and rewritten from scratch each run. Reads and writes in `chunkSize`-row chunks to stay within GAS memory limits.

To automate, set a time-based trigger on `mirrorSheet`.

---

## Deployment

```bash
cd ~/Desktop/GCX/SheetMirror
clasp push --force
```
