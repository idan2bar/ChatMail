// Parsing of address headers.

/** Parses an address header ("Name <a@b.c>, d@e.f") into [{ address, name }]. */
export function parseAddresses(header) {
  const out = [];
  const re = /(?:"([^"]*)"|([^",<]*?))\s*<([^<>\s]+@[^<>\s]+)>|([^\s,<>"]+@[^\s,<>"]+)/g;
  for (const m of header.matchAll(re)) {
    const address = (m[3] || m[4]).toLowerCase();
    out.push({ address, name: (m[1] || m[2] || '').trim() });
  }
  return out;
}

/**
 * The contacts a mail belongs to: its sender, except for mail the user sent themself (From is
 * `myAddress`), which belongs to its To/Cc recipients. The user's own address is never a contact.
 */
export function mailOwners(myAddress, { from, to, cc }) {
  const sender = parseAddresses(from || '');
  const owners = sender.some((a) => a.address === myAddress) ? parseAddresses([to, cc].join(',')) : sender.slice(0, 1);
  return owners.filter((a) => a.address !== myAddress);
}
