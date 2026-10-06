# Superseded integration acceptance

The previous dual-database, static V1/V2 account binding and iframe design is superseded by the user's corrected model: V2 extends V1, one customer/account registry, one fresh database and one native service. Do not deploy the old integration settings as the current solution.

Use [UNIFIED-PUBLISHER-DESIGN.md](UNIFIED-PUBLISHER-DESIGN.md) and [UNIFIED-PUBLISHER-RELEASE.md](UNIFIED-PUBLISHER-RELEASE.md). Preserve existing LP source fixes and old services for rollback; do not copy a running database into the new schema.
