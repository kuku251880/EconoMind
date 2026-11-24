from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select

from backend.accounts import Database, SignedIn, require_browser_header
from backend.series import MAX_CSV_BYTES, dataset_access, datasets, decode_csv, import_csv, observations, period_label

router = APIRouter(prefix="/api/v1/datasets", tags=["datasets"])


class DatasetRecord(BaseModel):
    id: int
    source: str
    owned: bool
    observation_count: int
    codes: list[str]
    first_period: str | None
    last_period: str | None


class DatasetCreated(BaseModel):
    dataset_id: int


@router.get("")
def list_datasets(account: SignedIn, engine: Database) -> list[DatasetRecord]:
    with engine.connect() as connection:
        records = connection.execute(
            select(
                datasets.c.id, datasets.c.source,
                (datasets.c.uploaded_by == account.id).is_(True).label("owned"),
                func.count(observations.c.dataset_id).label("observation_count"),
                func.array_agg(observations.c.code.distinct()).filter(
                    observations.c.code.is_not(None)
                ).label("codes"),
                func.min(observations.c.quarter).label("first_quarter"),
                func.max(observations.c.quarter).label("last_quarter"),
            )
            .outerjoin(observations)
            .where(dataset_access(account.id))
            .group_by(datasets.c.id)
            .order_by(datasets.c.id.desc())
        ).mappings().all()
    return [
        DatasetRecord(
            id=record["id"], source=record["source"], owned=record["owned"],
            observation_count=record["observation_count"], codes=sorted(record["codes"] or []),
            first_period=period_label(record["first_quarter"]) if record["first_quarter"] is not None else None,
            last_period=period_label(record["last_quarter"]) if record["last_quarter"] is not None else None,
        )
        for record in records
    ]


@router.post(
    "", status_code=201, dependencies=[Depends(require_browser_header)],
    max_body_size=MAX_CSV_BYTES + 65536, form_limits={"max_files": 1, "max_fields": 1},
)
def upload_dataset(
    account: SignedIn,
    engine: Database,
    source: Annotated[str, Form(min_length=1, max_length=200)],
    file: Annotated[UploadFile, File()],
) -> DatasetCreated:
    try:
        raw = file.file.read(MAX_CSV_BYTES + 1)
        dataset_id = import_csv(engine, decode_csv(raw), source, uploaded_by=account.id)
    except ValueError as error:
        status = 413 if len(raw) > MAX_CSV_BYTES else 422
        raise HTTPException(status, str(error)) from error
    return DatasetCreated(dataset_id=dataset_id)
