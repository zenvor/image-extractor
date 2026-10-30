# Interface screenshots

Captured on 2026-10-30 from the 1.2.1 build in isolated Chromium. The installed extension was not reloaded. Popup screenshots are native 2× captures of the 800×600 surface (1600×1200); task screenshots are 2560×1600.

| File | Content |
| --- | --- |
| [popup-en.jpg](popup-en.jpg) | English popup, two selected images. |
| [popup-zh-CN.jpg](popup-zh-CN.jpg) | Chinese popup, two selected images. |
| [format-filter-en.jpg](format-filter-en.jpg) | Open format-filter popover. |
| [downloads-en.jpg](downloads-en.jpg) | English task search, filters and cleanup. |
| [downloads-zh-CN.jpg](downloads-zh-CN.jpg) | Chinese task manager. |
| [whatsapp-source.jpg](whatsapp-source.jpg) | The source homepage in the same isolated browser. |

The extension analyzed the live [WhatsApp homepage](https://www.whatsapp.com/) and found 83 image addresses during capture. For a readable demonstration, the isolated session was reduced to eight representative results from that extraction, with two selected. The screenshots therefore show a curated interface demonstration, not the complete unfiltered result set. Images are loaded from their original sources. Task-manager records are seeded examples of completed, partially failed and cancelled tasks, not evidence of real downloads.

The capture-only manifest granted access to www.whatsapp.com and scontent.whatsapp.net. Those temporary grants are not in the repository or release package; shipped permissions remain unchanged. No UI content was painted over. WhatsApp names and imagery belong to their respective owners and are not relicensed under MIT. These examples do not imply affiliation or endorsement.
