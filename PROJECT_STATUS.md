# PR31 — bridge Collezione preparato — 21 ottobre 2026

**READY per revisione/rilascio coordinato; NON pubblicato.** Branch feat/pr31-collection-launch-20261021, base main 913c1a9ddf6d587868f0ed2defe5b713159f7522. Nessun commit su main, merge o workflow Pages avviato manualmente. GAS LIVE resta V30; V31 immutabile non attiva.

Modifica minima di index.html, identica al bridge canonico della PR31 (blob def481146fb83101e8f88b9ab3774edc691e53ca): mode=collection senza token acquisto; session=TOKEN resta identico, modalità sconosciute rifiutate. URL GAS, handshake per origine/nonce e invio initData solo via postMessage invariati. Parametri client per identità/credenziali/destinazioni ignorati e non inoltrati. La firma e l'autorizzazione continuano a essere verificate dal server.

Verifiche locali: node --test tests/bridge.test.js → 13 PASS, 0 FAIL. Prima della modifica 4 fallimenti attesi sul bridge purchase-only. git diff --check PASS. Nessuna rete Telegram, transazione reale o prova iPhone. Workflow esistenti non modificati: bridge-ci esegue test sulle PR; deploy-pages soltanto push main o workflow_dispatch. Le cartelle staging e staging-pr31 restano immutate.

Commit codice: 74098ec89f99f6988d04443a25616d3fa99fba14; test: 8fb58a383b5d9a714afec2014b17ccc4a06a408c.

Rilascio futuro, solo previa autorizzazione distinta: pubblicare prima questo bridge retrocompatibile e verificarne l'artefatto Pages; poi integrare i soli hunks controller già preparati nel progetto GAS esistente e pubblicare una nuova versione successiva a V31. V31 da sola non include /collezione. Infine collaudo iPhone richiesto dall'utente, non automatico.
Rollback GAS: selezionare V30 sul medesimo deployment senza cambiare URL/proprietario/Chiunque. Rollback bridge separato: ripristinare soltanto index.html al blob 6ea73ec15e92241675ca6f83dcc93e5908e1ee8b con un nuovo commit su main e verificare Pages; non toccare le cartelle staging o riscrivere la cronologia. In un rollback coordinato tornare prima a GAS V30, poi al bridge precedente. Nessun ripristino distruttivo di dati.

Piano completo e patch nel branch feat/inventory-disposition-20261016 del repository tcg-card-logger: docs/checkpoints/2026-10-21-pr31-bridge-bot-integration-ready.md. PR31 resta aperta/DRAFT. STOP prima di merge, Pages, editor GAS, deployment o messaggi.
