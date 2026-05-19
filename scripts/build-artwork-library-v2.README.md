# build-artwork-library-v2

One-time script to generate the free-tier photoreal botanical library.

## Run

```bash
REPLICATE_API_TOKEN=... node scripts/build-artwork-library-v2.mjs
```

Generates 5 variants × 15 occasions = 75 images at
`storage/artwork-library/v2/{occasion}/{n}.jpg`. Cost: ~$4.50.

## Re-roll specific occasions

```bash
REPLICATE_API_TOKEN=... node scripts/build-artwork-library-v2.mjs \
  --occasions=mothers_day,bereavement
```

Existing files are skipped — to re-roll, delete the file first.

## QA pass

After the run, open each file and apply the "is this AI?" test:

- If you can tell it's AI in under a second, delete the file and re-roll.
- If a variant has uncanny petals / impossible shadows, delete + re-roll.

Commit the directory only after every image passes.
