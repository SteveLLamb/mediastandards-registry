/*
Copyright (c), Steve LLamb

This work is licensed under the Creative Commons Attribution 4.0 International License.

You should have received a copy of the license along with this work.  If not, see <https://creativecommons.org/licenses/by/4.0/>.
*/

module.exports = (registry, name) => {
    /* is any key in the registry duplicated */

  const keys = []

  for (i in registry) {
    if (keys.includes(registry[i].groupId)) {
      throw name + " registry key " + registry[i].groupId + " is " + "duplicated";
    }
    keys.push(registry[i].groupId)
  }

  /* is the registry sorted */

  for (let i = 1; i < registry.length; i++) {
    if (registry[i-1].groupId >= registry[i].groupId) {
      throw name + " sort order " + registry[i-1].groupId + " is " +
        ((registry[i-1].groupId === registry[i].groupId) ? "duplicated" : "not sorted");
    }
  }
  
}
