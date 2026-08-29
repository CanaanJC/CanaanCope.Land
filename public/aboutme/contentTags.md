════════════════════════════════════════════════════════════════════════════
content.md SYNTAX REFERENCE
════════════════════════════════════════════════════════════════════════════

── BLOCK TAGS (layout) ────────────────────────────────────────────────────

[P1] ... [/P1]        Full-width row (number sets the row's vertical order)
[P1a] ... [/P1a]      Left half of row 1 (must pair with P1b)
[P1b] ... [/P1b]      Right half of row 1 (must pair with P1a)
[M1] ... [/M1]        Mobile-only row (nested inside a [P..] block, or
                       standalone) — invisible on desktop

── INLINE MEDIA TAGS (used inside <...>) ───────────────────────────────────

<fig1.png>                          Image
<fig1.gif>                          Looping/muted/autoplay animated image
                                     (always loops)
<clip.mp4>                          Video with normal playback controls
<clip.mp4 loop>                     Video forced to loop/mute/autoplay
                                     (GIF-style)
<clip.webm>                         Video with normal playback controls
<sound.mp3>                         Audio player with controls
<sound.wav>                         Audio player with controls
<./gallery>                         Folder of media → shows thumbnail, opens
                                     full gallery modal on click
<link:https://example.com>          Static 16:9 link preview card — click
                                     anywhere to open in a new tab
<link:https://example.com|click>    Interactive 16:9 embedded link preview —
                                     usable/scrollable iframe + "open in new
                                     tab" button
<stl:model.stl|#bgHex|#modelHex>    1:1 drag-to-orbit 3D model viewer
                                     (bg color, model color)

── USAGE RULES ─────────────────────────────────────────────────────────────

Single tag alone in a [P..]/[M..] side   → renders full-size
Tag placed mid-sentence with text        → renders inline, text splits around it
2+ tags, one per line, alone in a side   → renders as a vertical stack in one cell

── SUPPORTED FILE FORMATS ───────────────────────────────────────────────────

Image           : .png, .jpg, .jpeg, .webp, .svg, .avif
Animated image  : .gif
Video           : .mp4, .webm
Audio           : .mp3, .wav
3D model        : .stl
Folder gallery  : any folder containing a mix of the above
Link embed      : any http:// or https:// URL

════════════════════════════════════════════════════════════════════════════
