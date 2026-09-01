# Na potezu

Mobilna aplikacija za red i korišćenje bilijarskog i stonoteniskog stola. Interfejs je na srpskoj latinici, a server koristi autoritativno vreme, SQLite transakcije i SSE ažuriranja uživo.

## Lokalni razvoj

Potrebni su Node.js 22+ i npm.

```bash
npm install
npm run dev
```

Klijent je na `http://localhost:5173`, a API na portu `3123`.

## Provera i produkcija

```bash
npm test
npm run typecheck
npm run build
npm start
```

Podrazumevana baza je `./data/igraonica.db`. Putanja i port mogu da se promene promenljivama `DATABASE_PATH` i `PORT`. Za PM2 je priložen `ecosystem.config.cjs`:

```bash
pm2 start ecosystem.config.cjs
```

Caddy treba da prosledi saobraćaj na `localhost:3123`; isti Node proces servira API, SSE i izgrađeni frontend.

## Pravila

- Slobodan sto se zauzima odmah; za zauzet sto formira se FIFO red.
- Početno trajanje je 5–60 minuta, a podrazumevana vrednost je 15 minuta.
- Produženje od 15 minuta moguće je samo kada niko ne čeka.
- Prvi u redu automatski počinje kada se prethodna sesija završi.
- Jedno normalizovano ime može imati samo jednu aktivnu prijavu ili poziciju u redu.
- Četvorocifreni PIN služi za ponovno povezivanje i ne čuva se u izvornom obliku.
