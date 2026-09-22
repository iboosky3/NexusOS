"""PRD-owned consumption of confirmed prototype snapshots."""

from copy import deepcopy

from nexusos.prd.prototype import Prototype, prototype_appendix
from nexusos.prd.store import ConflictError
from nexusos.studio.integrity import digest
from nexusos.studio.plugin_contract import ArtifactConsumer


def propose(artifact: dict, payload: dict, target: dict) -> dict:
    appendix = prototype_appendix(Prototype.model_validate(payload))
    source_id = artifact["sourceResourceId"]
    start, end = (
        f"<!-- studio-source:{source_id}:start -->",
        f"<!-- studio-source:{source_id}:end -->",
    )
    section = f"{start}\n{appendix}\n{end}"
    content = target["content"]
    provenance = next(
        (
            entry
            for entry in target.get("provenance", [])
            if entry.get("sourceResourceId") == source_id
        ),
        None,
    )
    if start in content or end in content or provenance:
        if (
            content.count(start) != 1
            or content.count(end) != 1
            or content.index(start) >= content.index(end)
        ):
            raise ConflictError(
                "SOURCE_MARKERS_INVALID：来源区块标记异常，请保留正文并修复标记后重试"
            )
        left, right = content.index(start), content.index(end) + len(end)
        if not provenance or provenance.get("sectionDigest") != digest(content[left:right]):
            raise ConflictError(
                "SOURCE_SECTION_EDITED：已交接区块有人工修改，请先备份并对比，不能自动替换"
            )
        if provenance.get("artifactId") == artifact["id"]:
            raise ConflictError("ARTIFACT_ALREADY_APPLIED：当前文档已采用此产物，无需重复交接")
        content = content[:left] + section + content[right:]
    else:
        content = f"{content}\n\n{section}".strip()
    proposed = deepcopy(target)
    proposed["content"] = content
    proposed["provenance"] = [
        p for p in proposed.get("provenance", []) if p.get("sourceResourceId") != source_id
    ]
    proposed["provenance"].append(
        {
            "artifactId": artifact["id"],
            "digest": artifact["digest"],
            "sourceResourceId": source_id,
            "sourceRevision": artifact["sourceRevision"],
            "sectionDigest": digest(section),
        }
    )
    return proposed


consumer = ArtifactConsumer("nexus.prototype.snapshot", 1, propose)
