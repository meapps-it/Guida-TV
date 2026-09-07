# Guida TV

PWA italiana per consultare i programmi TV: **Adesso**, **Stasera**, **Oggi**, **Domani** e **Preferiti**.

## Come funziona
Il workflow `Aggiorna palinsesti TV` scarica il feed italiano EPGshare01 IT1, tiene solo una selezione di canali italiani e genera `data/tv.json`.

## Pubblicazione PWA
1. In GitHub: Settings → Pages.
2. Source: Deploy from a branch.
3. Branch: `main`, cartella `/ (root)`.
4. Apri l'URL GitHub Pages risultante.
5. Passa quell'URL a PWABuilder.

## Prima build dati
Dopo il caricamento del progetto, vai in Actions → `Aggiorna palinsesti TV` → Run workflow.

## Nota sui dati
Questo è un prototipo. Prima di una pubblicazione commerciale va verificata la licenza e la riutilizzabilità dei dati EPG scelti.
