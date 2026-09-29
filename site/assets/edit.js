// "Edit this beer" on beer pages -- Brooks only (the same ?me switch as
// rating). Sends only the fields that changed; tools/ingest/edit_beer.py
// writes them to data/beers/overrides.yml.
import { isMe, save } from './rate.js';

const box = document.querySelector('.edit-beer');
if (box && isMe) {
  box.hidden = false;
  const $ = (id) => document.getElementById(id);
  const fields = {
    brewery_name: 'ed-brewery-name', brewery_city: 'ed-brewery-city', brewery_state: 'ed-brewery-state',
    brewery_url: 'ed-brewery-url', name: 'ed-name', style: 'ed-style', abv: 'ed-abv',
  };
  const start = Object.fromEntries(Object.entries(fields).map(([k, id]) => [k, $(id).value.trim()]));
  const hopsStart = $('ed-hops').value.trim();
  $('ed-save').addEventListener('click', async () => {
    const q = (v) => JSON.stringify(v);
    const lines = [`brewery_slug: ${box.dataset.brewery}`, `beer_slug: ${box.dataset.beer}`];
    let changes = 0;
    for (const [k, id] of Object.entries(fields)) {
      const v = $(id).value.trim();
      if (v !== start[k]) { lines.push(`${k}: ${q(v)}`); changes++; }
    }
    const hops = $('ed-hops').value.trim();
    if (hops !== hopsStart) {
      lines.push(`hops: [${hops.split('\n').map((h) => h.trim()).filter(Boolean).map(q).join(', ')}]`);
      changes++;
    }
    if (!changes) { $('ed-status').textContent = 'Nothing changed yet.'; return; }
    lines.push(`brewery_name_now: ${q($('ed-brewery-name').value.trim())}`);
    const body = `<!-- hoplove-beer-edit -->\nSubmit to apply this correction to HopLove.\n\n\`\`\`yaml\n${lines.join('\n')}\n\`\`\`\n`;
    const title = `Edit: ${$('ed-name').value.trim()} (${$('ed-brewery-name').value.trim()})`;
    $('ed-save').disabled = true;
    const r = await save('edit', title, body);
    $('ed-save').disabled = false;
    $('ed-status').textContent = r.message;
  });
}
