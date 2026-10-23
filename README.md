# Calendario Turni

PWA (Progressive Web App) pensata per iPhone: legge il file Excel dei turni e lo trasforma in un calendario mensile, con orari, ore lavorate e, per ogni giorno, chi apre e chi chiude. Funziona anche offline.

Questa è la versione di sviluppo (Turni-sviluppo), dove si provano le novità.

## Funzioni

- Caricamento di uno o più file Excel (.xlsx, .xlsm, .xls): ogni file va al suo mese, con fino a 12 mesi in memoria; un file si elimina dal menu dei mesi scorrendolo verso sinistra
- Calendario mensile per nominativo, con orari, totale delle ore (1 ora di pausa tolta oltre le 8 ore), turni corti e turni che chiudono tardi evidenziati
- Pop-up del giorno con chi apre e chi chiude, e barra degli orari
- Ricerca del nominativo anche parziale (per esempio solo il cognome) e suggerimento dei nomi trovati nel file
- Modifica manuale dei turni e straordinari, con esportazione e importazione delle modifiche tra dispositivi
- Nomi collegati: una grafia diversa nel file viene letta come un nome già in elenco
- Orari di esercizio per giorno della settimana, dedotti dai file e correggibili
- Report mensile in PDF
- Tema chiaro e scuro, colore d'accento a scelta
- Nessun server dati: tutto resta nel dispositivo (localStorage)

## Il file Excel

- Foglio "Inserimento Orari": nominativi nella colonna B, giorni in blocchi di colonne
- Foglio "SETUP", cella E7: domenica di riferimento da cui partono le righe
- Il mese si ricava dal nome del file, che deve contenere il mese in italiano e l'anno (per esempio `08_rostering_agosto_2026.xlsx`)

## Stack tecnico

React 19, TanStack Router e Start, shadcn/ui, Tailwind CSS, Vite, Bun, xlsx, date-fns, vite-plugin-pwa.

## Struttura

- `src/routes/index.tsx`: pagina e interfaccia
- `src/routes/__root.tsx`: struttura della pagina, meta tag PWA, registrazione del service worker
- `src/lib/`: logica (turni e ore, file caricati, modifiche manuali, nomi collegati, backup, orari di esercizio, report PDF, tema, service worker, errori)
- `src/components/`: editor dei turni e straordinari; `ui/` contiene i componenti shadcn
- `src/server.ts` e `src/start.ts`: avvio del server e gestione degli errori
- `vite.config.ts`: build e configurazione PWA
- `public/`: manifest e icone

## Sviluppo locale

```bash
bun install
bun run dev
```

## Build

```bash
bun run build
```

## Pubblicazione

Su Cloudflare (Workers), collegato a questa repository: ogni commit sul ramo `main` avvia la build e la pubblicazione. L'esito si vede in Cloudflare, sotto Workers & Pages, nella scheda Deployments.

`bun.lock` è escluso da Git (vedi `.gitignore`) perché la versione di Bun in locale e quella di Cloudflare possono differire.

## PWA e offline

Il service worker tiene in cache pagina e risorse. Dopo un aggiornamento, l'app installata mostra la versione nuova alla seconda apertura. Per provare un deploy senza cache si apre il sito in una scheda privata di Safari. Aprendo l'indirizzo con `?sw=off` il service worker viene disattivato e rimosso.

Rimuovere l'app dalla schermata Home cancella i dati salvati: prima va esportato il backup delle modifiche.

## Versioni

Tre repository separate, tenute distinte di proposito: Turni (stabile), Turni-1.0 (copia di sicurezza) e Turni-sviluppo. Le funzioni sono quelle di Orari 1.0, portate in Turni.
