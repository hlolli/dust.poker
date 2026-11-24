/** Shared invites include only the table and network. Wallet connections and local options belong to the sender. */
export function tableLink(network: string, address: string, page = location.href): string {
  const source = new URL(page);
  const url = new URL(source.origin);
  url.pathname = source.pathname;
  url.search = new URLSearchParams({ network, table: address.toLowerCase() }).toString();
  return url.href;
}

/** A selectable link also works when clipboard access is denied. */
export function inviteCopy(network: string, address: string) {
  const group = document.createElement("div");
  group.className = "invite-copy row";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "leave";
  button.textContent = "Copy invite link";
  const link = document.createElement("input");
  link.readOnly = true;
  link.hidden = true;
  link.setAttribute("aria-label", "Table invite link");
  link.value = tableLink(network, address);
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  button.onclick = async () => {
    try {
      await navigator.clipboard.writeText(link.value);
      link.hidden = true;
      status.textContent = "Invite link copied.";
    } catch {
      link.hidden = false;
      link.focus();
      link.select();
      status.textContent = "Select and copy the invite link.";
    }
  };
  group.append(button, link, status);
  return group;
}
