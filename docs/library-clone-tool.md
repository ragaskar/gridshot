# Cloning a library tool

Sometimes a bin or drawer needs two of the same tool — a pair of pliers, two
identical wrenches. Rather than teaching the combine/compose machinery a
per-bin "quantity" concept, GridShot lets you duplicate the library entry
itself: clone it once, then select both the original and the clone like any
other two tools.

## Enabling it

Click **"⧉ Clone"** on any library card. A new, independent entry appears
(newest-first, so it shows up at the top of the list) with the same outline,
clearance, pocket settings, edit history, and provenance as the source, plus
its own copies of the thumbnail and captured photo if it has one. Its label
gets a `(copy)` suffix so the two are easy to tell apart in the list.

The clone has its own id from the moment it's created — deleting, editing,
or re-cloning either one never touches the other.

## Using it

Select both the original and its clone (or several clones) as you would any
two different tools, then use *Compose* (drawer) or *Arrange multi-tool
bin* as normal — each is placed as its own independent outline, since as far
as the rest of the app is concerned they're just two library entries that
happen to share a shape.

## Constraints

Cloning is available for any tool, including ones that aren't fully ready
yet — the clone can be fixed up independently of the source. There's no
limit on how many times you can clone a tool.
