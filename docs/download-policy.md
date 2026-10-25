# Download policies

Current source version: 1.0.0. Download policies control concurrent image transfers and how frequently new requests may start. They do not set a bandwidth limit or guarantee that a website will accept requests.

## Shared limits

| Policy | Global concurrency | Per-source concurrency | Minimum interval per source | Minimum global interval |
| --- | ---: | ---: | ---: | ---: |
| Low | 30 | 5 | 2 s | 250 ms |
| Medium (default) | 30 | 10 | 500 ms | 150 ms |
| High | 30 | 20 | 100 ms | 100 ms |
| Extra High | 30 | 25 | 75 ms | 75 ms |
| Max | 30 | 30 | 50 ms | 50 ms |

The global limit applies across all task pages. A transfer holds its slot until its response has been written to temporary storage, rather than releasing it when response headers arrive. Batch downloads, single-image ZIPs, failed-only retries, and recovery use the same scheduler; embedded data images do not consume network slots.

Known shards of IMX, Vipr, Pixhost, Imagebam, and Imgbox share one budget per provider. Other URLs are grouped by origin. Opening more tabs does not multiply the limits. A single task can use available capacity up to the configured source/global limits, but scheduling does not guarantee equal shares between tasks.

The start intervals are measured from actual transfer invocation. Admission and storage delays must not cause queued requests to start together. Completed or cancelled transfers release their concurrency slots without waiting for the remaining pacing interval. A source waiting for cooldown does not hold up unrelated sources.

## Server backpressure

HTTP 429 means too many requests; HTTP 503 means temporary unavailability and may also indicate overload or throttling. Both can include Retry-After. See [RFC 6585](https://www.rfc-editor.org/rfc/rfc6585.html#section-4) and [HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3).

1. A first 429 response pauses its source for at least 60 seconds; a first 503 response pauses it for at least 30 seconds. Longer server-provided delays take precedence.
2. Repeated incidents increase the extension's cooldown up to 15 minutes. A longer server-provided delay is not shortened. Responses arriving during one cooldown are grouped as one incident.
3. During recovery, the affected source is restricted to one transfer at a time. Its start interval increases with the penalty, up to 30 seconds. Every eight successful, format-validated image transfers reduces the penalty by one level.
4. A redirected response also applies cooldown to its final source. Users can still cancel waiting tasks; other sources can continue.

All five policies retain this behavior. A 503 response alone does not prove an IP ban. The limits are project choices, not capacities specified by HTTP standards or guarantees from image hosts.

## Slider and persistence

The shadcn/ui Slider has five discrete positions: Low, Medium, High, Extra High, and Max. Simplified Chinese labels are 低、中等、高、极高、超高. Medium is the default for new preferences. A retired unlimited setting also falls back to Medium.

Dragging previews the policy; releasing saves it. Arrow keys, Home, and End work as well. A failed save restores the saved setting and displays an error. Changes synchronize across extension pages. Limits are rechecked as requests are admitted; already running transfers are not forcibly terminated when a lower policy is selected.

## Validation boundaries

Automated tests cover global/source limits, shared provider shards, cross-task admission, actual-start spacing, policy changes, server cooldown, cancellation, recovery, and slot release. Local HTTP integration tests exercise streaming, stalled responses, ZIP output, failed-only retry, and cancellation recovery.

Local HTTP and simulated timing tests are distinct from Chrome acceptance and real image-host performance. The five current policies have not all been validated against live hosts. Historical tests used different clients and concurrency settings, so they are not a controlled comparison of the current presets.

Keep Medium as the initial setting. When evaluating another policy, compare successful images, final 429/503 errors, total elapsed time, and retry behavior under the same client and source conditions. A single successful batch does not establish a universally safe concurrency level.

Implementation: `lib/downloadSpeed.ts`, `lib/archive.ts`, and `components/DownloadSpeedControl.tsx`.
