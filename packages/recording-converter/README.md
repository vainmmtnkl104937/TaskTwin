# TaskTwin Recording Converter

`@tasktwin/recording-converter` deterministically translates one fully
validated, completed `RecordingArtifact` into a version 1 draft workflow and a
validated provenance report.

The package is framework-independent. It contains no NestJS, Prisma, Chrome,
DOM, Playwright, network, storage, or AI behavior. The caller supplies the
workflow identity and descriptive options; the converter does not read the
clock or generate random identifiers.

## Conversion boundary

- Source artifacts and every source event are parsed with
  `@tasktwin/recording-schema`.
- Source sequence order becomes workflow step order.
- Executable steps use the recorded unique primary locator.
- Locator fallbacks and confidence remain in the conversion report.
- Step IDs and generated variable or secret-reference names are deterministic.
- Masked values are represented by required variables only when the personal
  value can be requested safely later.
- Blocked password values may become secret references; no secret value is
  reconstructed or stored.
- Schema-valid unsafe events become explicit unresolved mappings.
- Malformed or unsupported source events reject the complete artifact with
  stable blocking input issues before workflow generation starts.
- Exact consecutive redundant state-setting events may be removed, but every
  removed event remains represented in the report.

`publishable` means only that conversion found no blocking issue. The generated
workflow remains `draft`; this package does not publish, edit, execute, repair,
or authorize a workflow.

An empty or entirely unresolved recording produces a validated
`no-executable-steps` result. It does not create a placeholder action.

## Commands

```sh
pnpm --filter @tasktwin/recording-converter lint
pnpm --filter @tasktwin/recording-converter typecheck
pnpm --filter @tasktwin/recording-converter test
pnpm --filter @tasktwin/recording-converter build
```
