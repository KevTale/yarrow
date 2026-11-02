# tempo

Read and write durations the way people do.

```ts
import { format, parse } from "@tempo-js/tempo";

parse("1h 30m");                         // 5400000
parse("1 hour and 5 minutes");           // 3900000
format(5_400_000);                       // "1 hour 30 minutes"
format(5_400_000, { style: "short" });   // "1h 30m"
format(5_430_500, { smallest: "m" });    // "1 hour 30 minutes"
```

## API

### `parse(text: string): number`

Milliseconds in `text`. Units: days (`d`, `day`, `days`), hours (`h`, `hr`, `hour`…), minutes (`m`, `min`…), seconds (`s`, `sec`…), milliseconds (`ms`). Decimals work (`1.5 hours`). Throws on anything else.

### `format(ms: number, options?): string`

- `style`: `"long"` (default) or `"short"`.
- `smallest`: the smallest unit shown (`"s"` by default); below it is dropped.

## Develop

```bash
npm install
npm test
npm run build
```
