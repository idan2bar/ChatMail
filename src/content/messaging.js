// Messaging to the background script.

/** Returns `askBackground(message)`: every background request is scoped to the account shown in this tab. */
export function createAskBackground(account) {
  return (message) =>
    new Promise((resolve, reject) =>
      chrome.runtime.sendMessage({ ...message, account }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!res?.ok) reject(new Error(res?.error || 'No response'));
        else resolve(res.data);
      }),
    );
}
