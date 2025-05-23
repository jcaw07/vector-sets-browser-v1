import SearchTimeIndicator from "@/app/components/SearchTimeIndicator"
import {
    ColumnConfig,
    useVectorResultsSettings,
} from "@/app/hooks/useVectorResultsSettings"
import { VectorTuple, vgetattr_multi } from "@/app/redis-server/api"
import { parseFieldFilters } from "@/app/utils/filterParser"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    ArrowDownUp,
    ArrowDownWideNarrow,
    ArrowUpNarrowWide,
    CheckSquare,
    Settings,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import EditAttributesDialog from "./EditAttributesDialog"
import EmptyVectorSet from "./EmptyVectorSet"

interface VectorResultsProps {
    results: VectorTuple[]
    onRowClick: (element: string) => void
    onDeleteClick: (e: React.MouseEvent, element: string) => void
    onShowVectorClick: (e: React.MouseEvent, element: string) => void
    onBulkDeleteClick?: (elements: string[]) => void
    searchTime?: string
    keyName: string
    searchFilter?: string
    searchQuery?: string
    onClearFilter?: () => void
    onAddVector?: () => void
    isSearching?: boolean
    isLoading?: boolean
    searchType?: "Vector" | "Element" | "Image"
    changeTab?: (tab: string, options?: { openSampleData?: boolean }) => void
}

type SortColumn = "element" | "score" | "none"
type SortDirection = "asc" | "desc"

type AttributeCache = {
    [key: string]: string | null
}

type AttributeValue = string | number | boolean | any[]
type ParsedAttributes = Record<string, AttributeValue>

// Add this new component for the attribute columns dialog
interface AttributeColumnsDialogProps {
    isOpen: boolean
    onClose: () => void
    columns: ColumnConfig[]
    onToggleColumn: (columnName: string, visible: boolean) => void
}

function AttributeColumnsDialog({
    isOpen,
    onClose,
    columns,
    onToggleColumn,
}: AttributeColumnsDialogProps) {
    const attributeColumns = columns.filter((col) => col.type === "attribute")

    // Add handlers for select all and deselect all
    const handleSelectAll = () => {
        attributeColumns.forEach((col) => {
            if (!col.visible) {
                onToggleColumn(col.name, true)
            }
        })
    }

    const handleDeselectAll = () => {
        attributeColumns.forEach((col) => {
            if (col.visible) {
                onToggleColumn(col.name, false)
            }
        })
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Attribute Columns</DialogTitle>
                    <DialogDescription>
                        Select which attribute columns to display in the results
                        table. Your selections will be saved for future
                        sessions.
                    </DialogDescription>
                </DialogHeader>

                {attributeColumns.length > 0 && (
                    <div className="flex justify-between items-center mb-4">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSelectAll}
                            className="text-xs"
                        >
                            Select All
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDeselectAll}
                            className="text-xs"
                        >
                            Deselect All
                        </Button>
                    </div>
                )}

                <ScrollArea className="h-[50vh] mt-4 pr-4">
                    <div className="space-y-0">
                        {attributeColumns.length === 0 ? (
                            <p className="text-sm text-gray-500">
                                No attribute columns available.
                            </p>
                        ) : (
                            attributeColumns.map((col) => (
                                <div
                                    key={col.name}
                                    className="flex items-center justify-between py-2"
                                >
                                    <Label
                                        htmlFor={`column-${col.name}`}
                                        className="grow"
                                    >
                                        {col.name.charAt(0).toUpperCase() +
                                            col.name.slice(1)}
                                    </Label>
                                    <Switch
                                        id={`column-${col.name}`}
                                        checked={col.visible}
                                        onCheckedChange={(checked) =>
                                            onToggleColumn(col.name, checked)
                                        }
                                    />
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>

                <div className="mt-6 flex justify-end">
                    <Button onClick={onClose}>Close</Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export default function VectorResults({
    results,
    onRowClick,
    onDeleteClick,
    onShowVectorClick,
    onBulkDeleteClick,
    keyName,
    searchFilter,
    searchQuery,
    onClearFilter,
    onAddVector,
    isSearching,
    searchTime,
    isLoading,
    searchType,
    changeTab,
}: VectorResultsProps) {
    const [isCompact, setIsCompact] = useState(true)
    const {
        showAttributes,
        setShowAttributes,
        showOnlyFilteredAttributes,
        setShowOnlyFilteredAttributes,
        updateAttributeColumnVisibility,
        getColumnVisibility,
        isLoaded,
    } = useVectorResultsSettings()

    // Store the getColumnVisibility function in a ref to avoid dependency issues
    const getColumnVisibilityRef = useRef(getColumnVisibility)

    // Update the ref when getColumnVisibility changes
    useEffect(() => {
        getColumnVisibilityRef.current = getColumnVisibility
    }, [getColumnVisibility])

    const [filterText, setFilterText] = useState("")
    const [sortColumn, setSortColumn] = useState<SortColumn>("none")
    const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
    const [editingAttributes, setEditingAttributes] = useState<string | null>(
        null
    )
    const [attributeCache, setAttributeCache] = useState<AttributeCache>({})
    const [isLoadingAttributes, setIsLoadingAttributes] = useState(false)
    const [filteredFieldValues, setFilteredFieldValues] = useState<
        Record<string, Record<string, string>>
    >({})
    const [parsedAttributeCache, setParsedAttributeCache] = useState<
        Record<string, ParsedAttributes>
    >({})
    const [availableColumns, setAvailableColumns] = useState<ColumnConfig[]>([
        { name: "element", visible: true, type: "system" },
        { name: "score", visible: true, type: "system" },
    ])
    const [isAttributeColumnsDialogOpen, setIsAttributeColumnsDialogOpen] =
        useState(false)

    // Add new state variables for selection mode
    const [selectMode, setSelectMode] = useState(false)
    const [selectedElements, setSelectedElements] = useState<Set<string>>(
        new Set()
    )

    // Clear selections when the keyName (vector set) changes
    useEffect(() => {
        setSelectMode(false)
        setSelectedElements(new Set())
    }, [keyName])

    // Handle individual selection toggle
    const handleSelectToggle = (element: string) => {
        setSelectedElements((prev) => {
            const newSet = new Set(prev)
            if (newSet.has(element)) {
                newSet.delete(element)
            } else {
                newSet.add(element)
            }
            return newSet
        })
    }

    // Handle "Select All" action
    const handleSelectAll = () => {
        const allElements = filteredAndSortedResults.map((row) => row[0])
        setSelectedElements(new Set(allElements))
    }

    // Handle "Deselect All" action
    const handleDeselectAll = () => {
        setSelectedElements(new Set())
    }

    // Handle exiting select mode
    const handleExitSelectMode = () => {
        setSelectMode(false)
        setSelectedElements(new Set())
    }

    // Handle bulk delete action
    const handleBulkDelete = () => {
        if (onBulkDeleteClick && selectedElements.size > 0) {
            onBulkDeleteClick(Array.from(selectedElements))
            setSelectedElements(new Set())
        }
    }

    // Add this effect to reset states when vectorSet changes
    useEffect(() => {
        // Reset to default columns
        setAvailableColumns([
            {
                name: "element",
                visible: getColumnVisibilityRef.current("element", true),
                type: "system",
            },
            {
                name: "score",
                visible: getColumnVisibilityRef.current("score", true),
                type: "system",
            },
        ])

        // Reset other related states
        setAttributeCache({})
        setParsedAttributeCache({})
        setFilteredFieldValues({})
        setEditingAttributes(null)
        setSortColumn("none")
        setSortDirection("asc")
        setFilterText("")

        setIsLoadingAttributes(false)
    }, [keyName])

    // Single source of truth for attribute fetching
    const fetchAttributes = async (elements: string[]) => {
        try {
            const response = await vgetattr_multi({
                keyName,
                elements,
                returnCommandOnly: false,
            })

            if (!response?.success || !response?.result) {
                console.error(`Error fetching attributes`, response?.error)
                return null
            }
            return response.result
        } catch (error) {
            console.error(`Error fetching attributes`, error)
            return null
        }
    }

    // Use this in the first useEffect
    useEffect(() => {
        if (!showAttributes || results.length === 0) return

        let isCancelled = false
        const elements = results.map((row) => row[0])

        const fetchAndProcessAttributes = async () => {
            setIsLoadingAttributes(true)
            try {
                const attributes = await fetchAttributes(elements)

                if (isCancelled || !attributes) return

                const newCache = { ...attributeCache }
                const newParsedCache: Record<string, ParsedAttributes> = {}
                const allAttributeColumns = new Set<string>()

                elements.forEach((element, i) => {
                    newCache[element] = attributes[i]
                    if (attributes[i]) {
                        try {
                            const parsed = JSON.parse(attributes[i])
                            newParsedCache[element] = parsed
                            Object.keys(parsed).forEach((key) =>
                                allAttributeColumns.add(key)
                            )
                        } catch (error) {
                            console.error(
                                `Error parsing attributes for ${element}:`,
                                error
                            )
                        }
                    }
                })

                if (!isCancelled) {
                    setAttributeCache(newCache)
                    setParsedAttributeCache(newParsedCache)

                    // Update columns in a single operation
                    setAvailableColumns((prev) => {
                        const systemColumns = prev.filter(
                            (col) => col.type === "system"
                        )
                        const attributeColumns = Array.from(
                            allAttributeColumns
                        ).map((name) => ({
                            name,
                            visible: getColumnVisibilityRef.current(name, true),
                            type: "attribute" as const,
                        }))
                        return [...systemColumns, ...attributeColumns]
                    })
                }
            } catch (error) {
                console.error("Error fetching attributes:", error)
            } finally {
                if (!isCancelled) {
                    setIsLoadingAttributes(false)
                }
            }
        }

        fetchAndProcessAttributes()

        return () => {
            isCancelled = true
        }
    }, [showAttributes, results, keyName])

    // Extract field names from searchFilter
    const filteredFields = useMemo(() => {
        if (!searchFilter) return []

        // Match all field names in the filter expression
        // Looking for patterns like .fieldname in the filter
        const fieldMatches =
            searchFilter.match(/\.[a-zA-Z_][a-zA-Z0-9_]*/g) || []

        // Remove the dot and deduplicate
        return Array.from(
            new Set(fieldMatches.map((field) => field.substring(1)))
        )
    }, [searchFilter])

    // Modify the column management effect to be simpler
    useEffect(() => {
        if (!showAttributes || (showOnlyFilteredAttributes && !searchFilter)) {
            // Only hide attribute columns, don't remove them
            setAvailableColumns((prev) =>
                prev.map((col) => ({
                    ...col,
                    visible: col.type === "system" ? col.visible : false,
                }))
            )
            return
        }

        // Show/hide appropriate columns based on filter
        setAvailableColumns((prev) => {
            return prev.map((col) => {
                if (col.type === "system") return col

                const shouldBeVisible =
                    !showOnlyFilteredAttributes ||
                    (showOnlyFilteredAttributes &&
                        filteredFields.includes(col.name))

                return {
                    ...col,
                    visible: shouldBeVisible,
                }
            })
        })
    }, [
        showAttributes,
        showOnlyFilteredAttributes,
        searchFilter,
        filteredFields,
    ])

    // Fetch field values when filtered fields change
    useEffect(() => {
        if (
            !showAttributes ||
            !showOnlyFilteredAttributes ||
            filteredFields.length === 0
        )
            return

        const newValues: Record<string, Record<string, string>> = {}

        for (const row of results) {
            const element = row[0]
            const parsedAttributes = parsedAttributeCache[element]

            if (parsedAttributes) {
                newValues[element] = {}
                for (const field of filteredFields) {
                    newValues[element][field] =
                        parsedAttributes[field]?.toString() || ""
                }
            }
        }

        setFilteredFieldValues(newValues)
    }, [
        showAttributes,
        showOnlyFilteredAttributes,
        filteredFields,
        results,
        parsedAttributeCache,
    ])

    // Handle dialog close with updated attributes
    const handleAttributesDialogClose = (updatedAttributes?: string) => {
        if (updatedAttributes && editingAttributes) {
            // If attributes were saved, update our cache directly
            setAttributeCache((prev) => ({
                ...prev,
                [editingAttributes]: updatedAttributes,
            }))

            try {
                // Also update the parsed cache
                const parsed = JSON.parse(updatedAttributes)
                setParsedAttributeCache((prev) => ({
                    ...prev,
                    [editingAttributes]: parsed,
                }))

                // Update available columns with any new attributes
                const newColumns = new Set(Object.keys(parsed))
                setAvailableColumns((prev) => {
                    const existingColumns = new Set(prev.map((c) => c.name))
                    const updatedColumns = [...prev]

                    newColumns.forEach((colName) => {
                        if (!existingColumns.has(colName)) {
                            updatedColumns.push({
                                name: colName,
                                visible: true,
                                type: "attribute",
                            })
                        }
                    })

                    return updatedColumns
                })
            } catch (e) {
                console.error(`Error parsing updated attributes:`, e)
            }
        }

        // Clear the editing state
        setEditingAttributes(null)
    }

    // Add this helper function
    const formatAttributeValue = (value: AttributeValue): string => {
        if (Array.isArray(value)) return "[...]"
        if (typeof value === "boolean") return value ? "true" : "false"
        if (value === null || value === undefined) return ""
        return String(value)
    }

    const handleSort = (column: SortColumn) => {
        if (sortColumn === column) {
            // Cycle through: asc -> desc -> none
            if (sortDirection === "asc") {
                setSortDirection("desc")
            } else if (sortDirection === "desc") {
                // Reset to no sorting
                setSortColumn("none")
            }
        } else {
            // Set new column and default to ascending
            setSortColumn(column)
            setSortDirection("asc")
        }
    }

    const filteredAndSortedResults = useMemo(() => {
        // First filter
        let processed = results
        if (filterText.trim()) {
            const lowerFilter = filterText.toLowerCase()
            processed = results.filter((row) =>
                row[0].toLowerCase().includes(lowerFilter)
            )
        }

        // Then sort, but only if a sort column is selected
        if (sortColumn === "none") {
            return processed // Return filtered results without sorting
        }

        return [...processed].sort((a, b) => {
            if (sortColumn === "element") {
                const comparison = a[0].localeCompare(b[0])
                return sortDirection === "asc" ? comparison : -comparison
            } else {
                // score
                const comparison = a[1] - b[1]
                return sortDirection === "asc" ? comparison : -comparison
            }
        })
    }, [results, filterText, sortColumn, sortDirection])

    const handleSearchSimilar = (element: string) => {
        // Use a combined callback that updates both values at once
        // This might help ensure the UI updates properly
        onRowClick(element)
    }

    // Modify the Add Vector button click handler
    const handleAddVector = async () => {
        if (onAddVector) {
            await onAddVector()
            // The parent component should handle refreshing the results
            // by updating the results prop after the vector is added
        }
    }

    // Update the handler for toggling column visibility
    const handleToggleColumn = (columnName: string, visible: boolean) => {
        // Update the local state
        setAvailableColumns((prev) =>
            prev.map((c) => (c.name === columnName ? { ...c, visible } : c))
        )

        // Persist the change to user settings
        updateAttributeColumnVisibility(columnName, visible)
    }

    // Check if the only result is the default first vector
    const isEmptyVectorSet = useMemo(() => {
        return results.length === 1 && results[0][0] === "Placeholder (Vector)"
    }, [results])

    // Update the early return to handle both empty results and loading state
    if (!isLoaded || isLoading || isSearching) {
        return (
            <div className="flex flex-col items-center justify-center py-12 space-y-4 text-gray-500">
                <SearchTimeIndicator
                    isSearching={true}
                    searchTime={searchTime ? parseFloat(searchTime) : undefined}
                />
                <p className="text-sm">
                    {!isLoaded
                        ? "Loading settings..."
                        : isLoading
                        ? "Loading vector set..."
                        : "Searching for vectors..."}
                </p>
            </div>
        )
    }

    // Check for empty vector set (only has default vector)
    if (isEmptyVectorSet) {
        return (
            <EmptyVectorSet
                onAddVector={onAddVector || (() => {})}
                onChangeTab={changeTab || (() => {})}
            />
        )
    }

    if (results.length === 0) {
        // Only show "No results" message if we're not in a loading state
        // and we have a valid vector set name
        if (!keyName) {
            return null // Don't show anything if no vector set is selected
        }
        if (searchQuery === "" && !searchFilter) {
            return (
                <div className="flex flex-col items-center justify-center py-12 space-y-4 text-gray-500">
                    <p className="">
                        No results to display
                    </p>
                </div>
            )
        } else {
            return (
                <div className="flex flex-col items-center justify-center py-12 space-y-4 text-gray-500">

                    <p className="">No results to display.</p>
                    {searchFilter && (
                        <p className="">
                            Try adjusting your search filter or query.
                        </p>
                    )}
                </div>
            )
        }
    }

    // Sort indicator icons
    const SortIcon = ({ column }: { column: SortColumn }) => {
        // If this column is not the active sort column or sorting is off
        if (sortColumn !== column || sortColumn === "none") {
            return <ArrowDownUp className="w-4 h-4 ml-1 text-gray-500" />
        }

        // Active sort column
        if (sortDirection === "asc") {
            return (
                <ArrowUpNarrowWide
                    className="w-4 h-4 ml-1 text-black"
                    strokeWidth={2.5}
                />
            )
        } else {
            return (
                <ArrowDownWideNarrow
                    className="w-4 h-4 ml-1 text-black"
                    strokeWidth={2.5}
                />
            )
        }
    }

    return (
        <div className="space-y-4 mb-8">
            <EditAttributesDialog
                isOpen={!!editingAttributes}
                onClose={handleAttributesDialogClose}
                keyName={keyName}
                element={editingAttributes || ""}
            />

            <AttributeColumnsDialog
                isOpen={isAttributeColumnsDialogOpen}
                onClose={() => setIsAttributeColumnsDialogOpen(false)}
                columns={availableColumns}
                onToggleColumn={handleToggleColumn}
            />

            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between mb-4">
                <div className="flex items-center gap-2 w-full">
                    {results.length > 0 ? (
                        <div className="flex items-center gap-2">
                            <div>
                                {(searchTime || isSearching) && (
                                    <SearchTimeIndicator
                                        searchTime={
                                            searchTime
                                                ? parseFloat(searchTime)
                                                : undefined
                                        }
                                        isSearching={isSearching}
                                    />
                                )}
                            </div>
                            <div className="grow"></div>
                            <div className="flex text-gray-500 text-sm items-center space-x-2 whitespace-nowrap">
                                {searchQuery ? (
                                    <div className="flex items-center space-x-2">
                                        {searchFilter && onClearFilter && (
                                            <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                                <span>Filtered results</span>
                                                <button
                                                    onClick={onClearFilter}
                                                    className="hover:bg-red-200 rounded-full p-0.5 ml-1"
                                                    aria-label="Clear filter"
                                                >
                                                    <svg
                                                        className="w-3 h-3"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            strokeWidth={2}
                                                            d="M6 18L18 6M6 6l12 12"
                                                        />
                                                    </svg>
                                                </button>
                                            </span>
                                        )}
                                    </div>
                                ) : searchFilter && onClearFilter ? (
                                    <div className="flex items-center space-x-2">
                                        <div>Filters:</div>
                                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                            <span>{searchFilter}</span>
                                            <button
                                                onClick={onClearFilter}
                                                className="hover:bg-red-200 rounded-full p-0.5 ml-1"
                                                aria-label="Clear filter"
                                            >
                                                <svg
                                                    className="w-3 h-3"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M6 18L18 6M6 6l12 12"
                                                    />
                                                </svg>
                                            </button>
                                        </span>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Message for empty search in Element search mode */}
                            {searchType === "Element" &&
                                (searchQuery === undefined ||
                                    searchQuery === "") &&
                                !isSearching &&
                                !isLoading && (
                                    <div className="ml-2 text-gray-500 text-sm flex items-center">
                                        Enter an element ID to search
                                    </div>
                                )}
                        </>
                    )}
                </div>
                <div className="flex items-center space-x-2">
                    {/* Selection mode controls */}
                    {selectMode ? (
                        <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium">
                                {selectedElements.size} selected
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleSelectAll}
                                className="text-xs"
                            >
                                Select All
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleDeselectAll}
                                className="text-xs"
                                disabled={selectedElements.size === 0}
                            >
                                Deselect All
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={handleBulkDelete}
                                disabled={selectedElements.size === 0}
                                className="text-xs"
                            >
                                Delete Selected
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleExitSelectMode}
                                className="text-xs"
                            >
                                Cancel
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center space-x-2">
                            {onAddVector && (
                                <Button
                                    variant="outline"
                                    onClick={handleAddVector}
                                >
                                    <div className="flex items-center space-x-2">
                                        <svg
                                            className="w-5 h-5"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M12 4v16m8-8H4"
                                            />
                                        </svg>
                                        <div className="text-xs">
                                            Add Vector
                                        </div>
                                    </div>
                                </Button>
                            )}
                            {/* Add a "Select" button to enable selection mode */}
                            <Button
                                variant="outline"
                                onClick={() => setSelectMode(true)}
                                disabled={results.length === 0}
                                className="text-xs"
                            >
                                <CheckSquare className="w-5 h-5 mr-1" />
                                Select
                            </Button>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className="text-xs"
                                    >
                                        <Settings className="h-4 w-4" />
                                        Options
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="end"
                                    className="w-56"
                                >
                                    <DropdownMenuCheckboxItem
                                        checked={isCompact}
                                        onCheckedChange={setIsCompact}
                                    >
                                        Compact View
                                    </DropdownMenuCheckboxItem>
                                    <DropdownMenuCheckboxItem
                                        checked={showAttributes}
                                        onCheckedChange={(checked) => {
                                            console.log(
                                                "Setting showAttributes to:",
                                                checked
                                            )
                                            setShowAttributes(checked)
                                        }}
                                    >
                                        Show Attributes
                                    </DropdownMenuCheckboxItem>
                                    {showAttributes && (
                                        <DropdownMenuCheckboxItem
                                            checked={showOnlyFilteredAttributes}
                                            onCheckedChange={(checked) => {
                                                console.log(
                                                    "Setting showOnlyFilteredAttributes to:",
                                                    checked
                                                )
                                                setShowOnlyFilteredAttributes(
                                                    checked
                                                )
                                            }}
                                            disabled={!showAttributes}
                                        >
                                            Show Only Filtered Attributes
                                        </DropdownMenuCheckboxItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel>
                                        Columns
                                    </DropdownMenuLabel>
                                    {/* System Columns */}
                                    <DropdownMenuLabel className="text-xs text-gray-500 pl-2">
                                        System
                                    </DropdownMenuLabel>
                                    {availableColumns
                                        .filter((col) => col.type === "system")
                                        .map((col) => (
                                            <DropdownMenuCheckboxItem
                                                key={col.name}
                                                checked={col.visible}
                                                onCheckedChange={(checked) => {
                                                    // Update local state
                                                    setAvailableColumns(
                                                        (prev) =>
                                                            prev.map((c) =>
                                                                c.name ===
                                                                col.name
                                                                    ? {
                                                                          ...c,
                                                                          visible:
                                                                              checked,
                                                                      }
                                                                    : c
                                                            )
                                                    )

                                                    // Persist the change
                                                    updateAttributeColumnVisibility(
                                                        col.name,
                                                        checked
                                                    )
                                                }}
                                            >
                                                {col.name
                                                    .charAt(0)
                                                    .toUpperCase() +
                                                    col.name.slice(1)}
                                            </DropdownMenuCheckboxItem>
                                        ))}

                                    {/* Attribute Columns Menu Item */}
                                    {availableColumns.some(
                                        (col) => col.type === "attribute"
                                    ) && (
                                        <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    setIsAttributeColumnsDialogOpen(
                                                        true
                                                    )
                                                }
                                                className="cursor-pointer"
                                            >
                                                <div className="flex items-center justify-between w-full">
                                                    <span>
                                                        Attribute Columns
                                                    </span>
                                                    <span className="text-xs text-gray-500">
                                                        {
                                                            availableColumns.filter(
                                                                (col) =>
                                                                    col.type ===
                                                                        "attribute" &&
                                                                    col.visible
                                                            ).length
                                                        }{" "}
                                                        /{" "}
                                                        {
                                                            availableColumns.filter(
                                                                (col) =>
                                                                    col.type ===
                                                                    "attribute"
                                                            ).length
                                                        }
                                                    </span>
                                                </div>
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    )}
                </div>
            </div>

            {isCompact ? (
                <Table>
                    <TableHeader>
                        <TableRow>
                            {/* Add a checkbox column when in select mode */}
                            {selectMode && (
                                <TableHead className="w-12">
                                    <div className="flex items-center justify-center">
                                        <input
                                            type="checkbox"
                                            checked={
                                                selectedElements.size ===
                                                    filteredAndSortedResults.length &&
                                                filteredAndSortedResults.length >
                                                    0
                                            }
                                            onChange={(e) =>
                                                e.target.checked
                                                    ? handleSelectAll()
                                                    : handleDeselectAll()
                                            }
                                            className="h-4 w-4 rounded border-gray-300"
                                        />
                                    </div>
                                </TableHead>
                            )}

                            {availableColumns
                                .filter((col) => col.visible)
                                .map((col) => {
                                    const filter = parseFieldFilters(
                                        searchFilter
                                    ).find((f) => f.field === col.name)

                                    return (
                                        <TableHead
                                            key={col.name}
                                            className={`relative ${
                                                col.type === "system"
                                                    ? "cursor-pointer hover:bg-gray-50"
                                                    : ""
                                            }`}
                                            onClick={() =>
                                                col.type === "system"
                                                    ? handleSort(
                                                          col.name as SortColumn
                                                      )
                                                    : undefined
                                            }
                                        >
                                            {filter && (
                                                <div className="absolute -top-px left-0 right-0 h-0.5 bg-red-500" />
                                            )}
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    {filter && (
                                                        <div className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
                                                    )}
                                                    <span className="font-medium">
                                                        {col.name
                                                            .charAt(0)
                                                            .toUpperCase() +
                                                            col.name.slice(1)}
                                                    </span>
                                                    {col.type === "system" && (
                                                        <SortIcon
                                                            column={
                                                                col.name as SortColumn
                                                            }
                                                        />
                                                    )}
                                                </div>
                                                {filter && (
                                                    <div
                                                        className="text-xs text-red-600 font-normal truncate"
                                                        title={
                                                            filter.expression
                                                        }
                                                    >
                                                        {filter.expression}
                                                    </div>
                                                )}
                                            </div>
                                        </TableHead>
                                    )
                                })}
                            <TableHead className="text-right">
                                Actions
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredAndSortedResults.map((row, index) => (
                            <TableRow
                                key={index}
                                className={`group ${
                                    selectedElements.has(row[0])
                                        ? "bg-blue-50"
                                        : ""
                                }`}
                            >
                                {/* Add a checkbox cell when in select mode */}
                                {selectMode && (
                                    <TableCell className="w-12">
                                        <div className="flex items-center justify-center">
                                            <input
                                                type="checkbox"
                                                checked={selectedElements.has(
                                                    row[0]
                                                )}
                                                onChange={() =>
                                                    handleSelectToggle(row[0])
                                                }
                                                className="h-4 w-4 rounded border-gray-300"
                                                onClick={(e) =>
                                                    e.stopPropagation()
                                                } // Prevent row click when clicking checkbox
                                            />
                                        </div>
                                    </TableCell>
                                )}

                                {availableColumns
                                    .filter((col) => col.visible)
                                    .map((col) => (
                                        <TableCell
                                            key={col.name}
                                            onClick={
                                                selectMode
                                                    ? () =>
                                                          handleSelectToggle(
                                                              row[0]
                                                          )
                                                    : undefined
                                            }
                                            className={
                                                selectMode
                                                    ? "cursor-pointer"
                                                    : ""
                                            }
                                        >
                                            {col.type === "system" ? (
                                                col.name === "element" ? (
                                                    <div className="line-clamp-2 break-words">
                                                        {row[0]}
                                                    </div>
                                                ) : typeof row[1] ===
                                                  "number" ? (
                                                    row[1].toFixed(4)
                                                ) : (
                                                    row[1]
                                                )
                                            ) : (
                                                formatAttributeValue(
                                                    parsedAttributeCache[
                                                        row[0]
                                                    ]?.[col.name]
                                                )
                                            )}
                                        </TableCell>
                                    ))}
                                <TableCell className="text-right">
                                    <div className="flex justify-end -space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {!selectMode && (
                                            <>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() =>
                                                        handleSearchSimilar(
                                                            row[0]
                                                        )
                                                    }
                                                    className="h-8 w-8"
                                                    title="Search similar vectors"
                                                >
                                                    <svg
                                                        className="w-4 h-4"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            strokeWidth={2}
                                                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                                        />
                                                    </svg>
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={(e) =>
                                                        onShowVectorClick(
                                                            e,
                                                            row[0]
                                                        )
                                                    }
                                                    className="h-8 w-8"
                                                    title="Copy vector"
                                                >
                                                    <svg
                                                        className="w-4 h-4"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            strokeWidth={2}
                                                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                                        />
                                                    </svg>
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() =>
                                                        setEditingAttributes(
                                                            row[0]
                                                        )
                                                    }
                                                    className="h-8 w-8"
                                                    title="Edit attributes"
                                                >
                                                    <svg
                                                        className="w-4 h-4"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            strokeWidth={2}
                                                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                                        />
                                                    </svg>
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={(e) =>
                                                        onDeleteClick(e, row[0])
                                                    }
                                                    className="h-8 w-8 text-red-600"
                                                    title="Delete vector"
                                                >
                                                    <svg
                                                        className="w-4 h-4"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            strokeWidth={2}
                                                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                                        />
                                                    </svg>
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            ) : (
                <div className="space-y-4 mb-8">
                    {filteredAndSortedResults.map((row, index) => (
                        <div
                            key={index}
                            className={`bg-[white] rounded-lg border p-4 hover:shadow-md group ${
                                selectedElements.has(row[0])
                                    ? "border-blue-400 bg-blue-50"
                                    : ""
                            }`}
                            onClick={
                                selectMode
                                    ? () => handleSelectToggle(row[0])
                                    : undefined
                            }
                        >
                            <div className="flex items-start justify-between w-full">
                                {/* Add checkbox in non-compact view */}
                                {selectMode && (
                                    <div className="mr-2 mt-1">
                                        <input
                                            type="checkbox"
                                            checked={selectedElements.has(
                                                row[0]
                                            )}
                                            onChange={() =>
                                                handleSelectToggle(row[0])
                                            }
                                            className="h-4 w-4 rounded border-gray-300"
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    </div>
                                )}
                                <div className="flex items-start space-x-4 w-full">
                                    <div className="bg-gray-100 rounded-lg p-2 text-gray-600">
                                        {index + 1}
                                    </div>
                                    <div className="flex flex-col gap-2 w-full">
                                        <div className="grow">
                                            <div className="text-sm text-gray-500 uppercase">
                                                Element
                                            </div>
                                            <div className="font-medium">
                                                {row[0]}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-sm text-gray-500">
                                                SCORE
                                            </div>
                                            <div className="font-medium">
                                                {typeof row[1] === "number"
                                                    ? row[1].toFixed(4)
                                                    : row[1]}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                {!selectMode && (
                                    <div className="flex flex-col items-end space-y--1 text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button
                                            variant="ghost"
                                            onClick={() =>
                                                handleSearchSimilar(row[0])
                                            }
                                            className="p-2 hover:bg-gray-100 rounded-full flex items-center gap-2 text-gray-500"
                                            title="Search similar vectors"
                                        >
                                            <svg
                                                className="w-5 h-5"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                                />
                                            </svg>
                                            Find Similar
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            onClick={(e) =>
                                                onShowVectorClick(e, row[0])
                                            }
                                            className="p-2 hover:bg-gray-100 rounded-full text-gray-500 flex items-center gap-2"
                                            title="Copy vector"
                                        >
                                            <svg
                                                className="w-5 h-5"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                                />
                                            </svg>
                                            Copy Vector
                                        </Button>
                                        {!showAttributes && (
                                            <Button
                                                variant="ghost"
                                                onClick={() =>
                                                    setEditingAttributes(row[0])
                                                }
                                                className="p-2 hover:bg-gray-100 rounded-full text-gray-500 flex items-center gap-2"
                                                title="Edit attributes"
                                            >
                                                <svg
                                                    className="w-5 h-5"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                                    />
                                                </svg>
                                                Edit Attributes
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            onClick={(e) =>
                                                onDeleteClick(e, row[0])
                                            }
                                            className="p-2 hover:bg-gray-100 rounded-full text-red-600 flex items-center gap-2"
                                            title="Delete vector"
                                        >
                                            <svg
                                                className="w-5 h-5"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                                />
                                            </svg>
                                            Delete
                                        </Button>
                                    </div>
                                )}
                            </div>
                            {showOnlyFilteredAttributes &&
                                filteredFields.map((field) => (
                                    <div key={field}>
                                        <div className="text-sm text-gray-500 uppercase">
                                            {field}
                                        </div>
                                        <div className="font-medium">
                                            {filteredFieldValues[row[0]]?.[
                                                field
                                            ] || ""}
                                        </div>
                                    </div>
                                ))}
                            {showAttributes && !showOnlyFilteredAttributes && (
                                <div className="w-full pl-10">
                                    <div className="text-sm text-gray-500">
                                        ATTRIBUTES
                                    </div>
                                    {isLoadingAttributes &&
                                    attributeCache[row[0]] === undefined ? (
                                        <div className="text-sm text-gray-500">
                                            Loading...
                                        </div>
                                    ) : attributeCache[row[0]] ? (
                                        <div className="flex gap-4 flex-wrap bg-gray-50 rounded-md p-2 w-full items-center">
                                            {Object.entries(
                                                parsedAttributeCache[row[0]] ||
                                                    {}
                                            ).map(([key, value]) => (
                                                <div
                                                    key={key}
                                                    className="flex flex-col"
                                                >
                                                    <div className="text-xs text-gray-500 uppercase">
                                                        {key}
                                                    </div>
                                                    <div className="">
                                                        {formatAttributeValue(
                                                            value
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                            <div className="grow"></div>
                                            <Button
                                                variant="ghost"
                                                onClick={() =>
                                                    setEditingAttributes(row[0])
                                                }
                                                className="h-8 w-8 text-gray-500 mr-2"
                                                title="Edit attributes"
                                            >
                                                <svg
                                                    className="w-4 h-4"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                                    />
                                                </svg>
                                                Edit
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                setEditingAttributes(row[0])
                                            }
                                        >
                                            Add Attributes
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
