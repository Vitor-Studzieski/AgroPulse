import pytest
from pydantic import ValidationError

from app.geo import area_ha, centroid, is_closed, square
from app.models import Point, Polygon


def test_square_area_is_close_to_expected():
    ring = square(-55.7, -12.5, 1.0)["coordinates"][0]
    assert area_ha(ring) == pytest.approx(100, rel=0.02)


def test_centroid_is_center_of_square():
    ring = square(-55.7, -12.5, 2.0)["coordinates"][0]
    lon, lat = centroid(ring)["coordinates"]
    assert lon == pytest.approx(-55.7, abs=1e-9)
    assert lat == pytest.approx(-12.5, abs=1e-9)


def test_centroid_uses_area_weighting_for_irregular_polygon():
    ring = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2], [0, 0]]
    lon, lat = centroid(ring)["coordinates"]
    assert lon == pytest.approx(5 / 6, abs=1e-8)
    assert lat == pytest.approx(5 / 6, abs=1e-8)


def test_polygon_area_and_centroid_account_for_holes():
    outer = [[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]]
    hole = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]
    expected = area_ha(outer) - area_ha(hole)
    assert area_ha([outer, hole]) == pytest.approx(expected)
    lon, lat = centroid([outer, hole])["coordinates"]
    assert lon == pytest.approx(0, abs=1e-12)
    assert lat == pytest.approx(0, abs=1e-12)


def test_geo_models_reject_invalid_coordinates_and_degenerate_polygons():
    with pytest.raises(ValidationError):
        Point(coordinates=[181, 0])
    with pytest.raises(ValidationError):
        Polygon(coordinates=[[[0, 0], [1, 0], [2, 0], [0, 0]]])
    with pytest.raises(ValidationError):
        Polygon(coordinates=[[[0, 0], [4, 4], [0, 4], [3, 0], [0, 0]]])
    with pytest.raises(ValidationError):
        Polygon(
            coordinates=[
                [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
                [[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]],
            ]
        )


def test_is_closed():
    assert is_closed([[0, 0], [1, 0], [1, 1], [0, 0]])
    assert not is_closed([[0, 0], [1, 0], [1, 1], [0, 1]])
