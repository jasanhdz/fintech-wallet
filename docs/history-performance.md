# Historial: fixture 100k y EXPLAIN real

Evidencia capturada en la rama integrada `feature/product-mvp`, con Node 26.13.1 y PostgreSQL 16.10 local. El comando solo permite `TEST_DATABASE_URL`/`TEST_MIGRATOR_DATABASE_URL` locales de `wallet_test`; el guard rechaza `wallet_dev` antes de conectar como fixture. No se modificaron bases de Lucem.

```sh
npm run db:migrate:test
npm run qa:history-performance
```

`qa:history-performance` crea/reusa un usuario y cuentas sintéticas dedicadas, junto con exactamente 100,000 transferencias completadas y movimientos de débito en su cuenta fuente (100,000 movimientos balanceados de crédito a la cuenta clearing). Inserta con IDs deterministas y `ON CONFLICT DO NOTHING`; se ejecutó dos veces y en ambas informó 100,000 filas, sin duplicar. La fixture queda en `wallet_test` para reproducir el plan y no crea saldos de usuario de desarrollo.

Consulta medida: movimiento por cuenta propia, transfers completadas, ventana de 100 días, tipo `debit`, siguiente página con cursor keyset real derivado del último registro de la página previa (tuple `created_at,id`) y `LIMIT 20`, usando joins a ledger transaction y transfer. Índices usados: `ledger_entries_account_created_idx`, `ledger_transactions_pkey`, `transfers_pkey`. Salida íntegra del último `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)`:

```text
Limit  (cost=1.26..33.99 rows=20 width=127) (actual time=0.049..0.118 rows=20 loops=1)
  Buffers: shared hit=164
  ->  Nested Loop  (cost=1.26..75390.07 rows=46074 width=127) (actual time=0.048..0.116 rows=20 loops=1)
        Buffers: shared hit=164
        ->  Nested Loop  (cost=0.85..43639.32 rows=46639 width=54) (actual time=0.032..0.071 rows=20 loops=1)
              Buffers: shared hit=84
              ->  Index Scan using ledger_entries_account_created_idx on ledger_entries le  (cost=0.42..14306.67 rows=47218 width=54) (actual time=0.018..0.022 rows=20 loops=1)
                    Index Cond: ((account_id = '00000000-0000-4000-8000-000000000101'::uuid) AND (ROW(created_at, id) < ROW('2026-11-15 00:10:45.250752+00'::timestamp with time zone, '70000000-0000-4000-8000-000000000020'::uuid)))
                    Filter: (((entry_type)::text = ANY ('{debit,credit}'::text[])) AND ((entry_type)::text = 'debit'::text))
                    Buffers: shared hit=4
              ->  Memoize  (cost=0.43..0.68 rows=1 width=32) (actual time=0.002..0.002 rows=1 loops=20)
                    Cache Key: le.ledger_transaction_id
                    Cache Mode: logical
                    Hits: 0  Misses: 20  Evictions: 0  Overflows: 0  Memory Usage: 3kB
                    Buffers: shared hit=80
                    ->  Index Scan using ledger_transactions_pkey on ledger_transactions lt  (cost=0.42..0.67 rows=1 width=32) (actual time=0.002..0.002 rows=1 loops=20)
                          Index Cond: (id = le.ledger_transaction_id)
                          Filter: ((reference_type)::text = 'transfer'::text)
                          Buffers: shared hit=80
        ->  Index Scan using transfers_pkey on transfers t  (cost=0.42..0.67 rows=1 width=65) (actual time=0.002..0.002 rows=1 loops=20)
              Index Cond: (id = lt.reference_id)
              Filter: ((completed_at IS NOT NULL) AND (completed_at >= '2026-08-07 05:22:33.574+00'::timestamp with time zone) AND ((status)::text = 'completed'::text))
              Buffers: shared hit=80
Planning:
  Buffers: shared hit=121
Planning Time: 1.503 ms
Execution Time: 0.549 ms
```

Es una ejecución local reproducible, no una promesa de latencia de producción. La cuenta usada es sintética y pertenece solo a la fixture de `wallet_test`.
