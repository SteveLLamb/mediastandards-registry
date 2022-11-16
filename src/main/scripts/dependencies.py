import json
from optparse import OptionParser, OptionValueError

usage = "%prog [options] <input-file>"
parser = OptionParser(usage=usage)

parser.add_option("-n",
        action="store_true",
        dest="normative",
        default=True,
        help="Set reference check to Normative")
parser.add_option("-b",
        action="store_true",
        dest="bibliographic",
        default=True,
        help="Set reference check to Bibliographic")

options, args = parser.parse_args()
normative = options.normative
bibliographic = options.bibliographic

if normative:
  refType = "normative"
elif bibliographic:
  refType = "bibliographic"

if len(args) > 1:
        parser.error("You can only select a single input file!")
if len(args) < 1:
        parser.error("You must select an input file!")

docId = str(args).strip("[]'")


#def find_dependents(doc_id):
#
#  doc_is_required_by = is_required_by.get(doc_id)
#
#  if doc_is_required_by is None:
#    doc_is_required_by = set()
#    is_required_by[doc_id] = doc_is_required_by
#
#  for doc in documents:
#
#    if doc.get("group") != "27C":
#      continue
#
#    if "status" in doc and "superseded" in doc["status"] and  doc["status"]["superseded"]:
#      continue
#
#    if "references" not in doc or "normative" not in doc["references"]:
#      continue
#
#    if doc_id in doc["references"]["normative"]:
#
#      dependent_doc_id = doc["docId"]
#
#      if dependent_doc_id not in doc_is_required_by:
#        doc_is_required_by.add(dependent_doc_id)
#        find_dependents(dependent_doc_id)


def find_dependencies(docs_by_id, doc_id, deps):

  doc = docs_by_id[doc_id]

  if "references" not in doc or refType not in doc["references"]:
    return

  for dep_doc_id in doc["references"][refType]:

    if dep_doc_id in deps:
      continue

    deps.add(dep_doc_id)
    find_dependencies(docs_by_id, dep_doc_id, deps)


with open("../data/documents.json", encoding="utf-8") as fp:
  documents = json.load(fp)

docs_by_id = {}

for doc in documents:
  docs_by_id[doc["docId"]] = doc

deps = set()

find_dependencies(docs_by_id, docId, deps)

for dep_id in sorted(deps):
  dep = docs_by_id[dep_id]
  if  dep['status'].get('superseded', False):
    qual = "[S]"
  elif dep['status'].get('withdrawn', False):
    qual = "[W]"
  else:
    qual = ""
  print(f"{dep_id} ({dep['docLabel']}, {dep['docTitle']}) {qual}")
  #print(f"{dep['docLabel']} {qual}")

